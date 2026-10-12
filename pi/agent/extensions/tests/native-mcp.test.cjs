const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");

for (const [name, flags, defaultUrl, skills] of [
  ["revenuecat", ["revenuecat"], "https://mcp.revenuecat.ai/mcp", "ai-toolkit/revenuecat/skills"],
  ["amplitude", ["amplititude", "amplitude"], "https://mcp.amplitude.com/mcp", "mcp-marketplace/plugins/amplitude/skills"],
]) {
  test(`${name}: opt-in native MCP and skills`, async (t) => {
    const initialize = (await import(`../${name}/index.ts`)).default;
    const envKey = `PI_${name.toUpperCase()}_MCP_URL`;
    const originalUrl = process.env[envKey];
    t.after(() => {
      if (originalUrl === undefined) delete process.env[envKey];
      else process.env[envKey] = originalUrl;
    });

    for (const enabledFlags of [[], ...flags.map((flag) => [flag]), flags]) {
      for (const override of [undefined, "", "http://127.0.0.1:8765/mcp"]) {
        if (override === undefined) delete process.env[envKey];
        else process.env[envKey] = override;
        const events = new Map();
        const commands = new Map();
        const registeredFlags = new Map();
        const servers = new Map();
        let parsed = false;
        let registrations = 0;
        initialize({
          registerFlag: (flag, config) => registeredFlags.set(flag, config),
          getFlag: (flag) => {
            assert.ok(parsed, "flags must not be read before CLI parsing");
            return enabledFlags.includes(flag);
          },
          on: (event, handler) => events.set(event, handler),
          registerCommand: (command, config) => commands.set(command, config),
          registerMcpServer: (server, config) => {
            registrations++;
            servers.set(server, config);
          },
        });
        assert.deepEqual([...registeredFlags.keys()], flags);
        for (const config of registeredFlags.values()) {
          assert.equal(config.type, "boolean");
          assert.equal(config.default, false);
        }
        assert.equal(servers.size, 0, "loading/help must not start a connection");
        parsed = true;
        const enabled = enabledFlags.length > 0;
        const discovered = await events.get("resources_discover")();
        const skillsPath = resolve(__dirname, "..", name, skills);
        assert.deepEqual(discovered, enabled ? { skillPaths: [skillsPath] } : undefined);
        if (enabled) assert.ok(existsSync(skillsPath), "official skills directory is missing");
        await events.get("session_start")();
        assert.equal(registrations, enabled ? 1 : 0);
        assert.equal(servers.size, enabled ? 1 : 0);
        if (enabled) {
          const config = servers.get(name);
          assert.equal(config.url, override || defaultUrl);
          assert.equal(config.exposure, "codemode");
          assert.ok(config.description);
          assert.equal(config.command, undefined, "must not launch mcp-remote");
        }
        const messages = [];
        await commands.get(`${name}-status`).handler("", {
          ui: { notify: (message) => messages.push(message) },
        });
        assert.match(messages[0], enabled ? new RegExp(`/mcp login ${name}`) : /disabled/);
      }
    }
  });
}
