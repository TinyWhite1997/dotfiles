const assert = require("node:assert/strict");
const { createRequire, registerHooks } = require("node:module");
const { test } = require("node:test");
const { PassThrough } = require("node:stream");
const { homedir, tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

// Use the real SDK (including its timers/cancellation), substituting only the
// transport and Pi UI. No Agency process, credentials, network or PR is touched.
const installed = createRequire(join(homedir(), ".pi/agent/extensions/package.json"));
const resolveSdk = (name) => {
  try { return require.resolve(name); } catch { return installed.resolve(name); }
};
// Resolve before registering hooks: require.resolve inside a resolve hook recurses.
const sdkClientUrl = pathToFileURL(resolveSdk("@modelcontextprotocol/sdk/client/index.js")).href;
const NativeStdio = require(resolveSdk("@modelcontextprotocol/sdk/client/stdio.js")).StdioClientTransport;
// Optional real-time, real-child-process probe; still never connects to a PR.
const stdioFixture = `
const lines = require('node:readline').createInterface({ input: process.stdin });
const send = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
let beat, end;
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: {
    protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' }
  }});
  if (m.method === 'ping') send({ id: m.id, result: {} });
  if (m.method === 'tools/call') {
    const started = Date.now();
    const progress = () => send({ method: 'notifications/progress', params: {
      progressToken: m.params._meta.progressToken, progress: (Date.now() - started) / 1000, message: 'fixture watching'
    }});
    progress();
    beat = setInterval(progress, 30000);
    end = setTimeout(() => {
      clearInterval(beat);
      send({ id: m.id, result: { content: [{ type: 'text', text: 'fixture handoff after 185 seconds' }] }});
    }, 185000);
  }
  if (m.method === 'notifications/cancelled') { clearInterval(beat); clearTimeout(end); }
});
lines.on('close', () => { clearInterval(beat); clearTimeout(end); });
`;
const flush = () => new Promise(setImmediate);
class Transport {
  static instances = [];
  static mode = "normal";
  constructor(options) {
    if (Transport.mode === "real-stdio" && options.args[1] === "finish-pr") {
      const native = new NativeStdio({ ...options, command: process.execPath, args: ["-e", stdioFixture] });
      Transport.instances.push(native);
      return native;
    }
    this.options = options;
    this.mode = Transport.mode;
    this.stderr = new PassThrough();
    this.messages = [];
    Transport.instances.push(this);
  }
  async start() {
    if (this.options.args[1] === "finish-pr" && this.mode === "spawn-error") {
      throw new Error("agency executable missing");
    }
  }
  receive(message) { queueMicrotask(() => this.onmessage?.({ jsonrpc: "2.0", ...message })); }
  async send(message) {
    this.messages.push(message);
    const finish = this.options.args[1] === "finish-pr";
    if (message.method === "initialize") {
      if (finish && this.mode === "handshake-held") return;
      if ((finish && this.mode === "handshake-error") || (!finish && this.mode === "gateway-error")) {
        this.stderr.write("backend diagnostic");
        this.receive({ id: message.id, error: { code: -32603, message: "sign-in failed" } });
      } else {
        this.receive({ id: message.id, result: {
          protocolVersion: "2025-06-18", capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        } });
      }
    } else if (message.method === "tools/list") {
      this.receive({ id: message.id, result: { tools: [{
        name: "call_tool", inputSchema: { type: "object" },
      }] } });
    } else if (message.method === "ping") {
      this.receive(this.mode === "ping-error"
        ? { id: message.id, error: { code: -32603, message: "transport ping refused" } }
        : { id: message.id, result: {} });
    } else if (message.method === "tools/call") {
      this.request = message;
      if (!finish) this.reply("through gateway");
    }
  }
  progress(seconds) {
    const token = this.request.params._meta?.progressToken;
    assert.notEqual(token, undefined, "SDK must request progress even without a Pi UI callback");
    this.receive({ method: "notifications/progress", params: {
      progressToken: token, progress: seconds, message: `Watching PR: ${seconds}s`,
    } });
  }
  reply(text, isError = false) {
    this.receive({ id: this.request.id, result: { content: [{ type: "text", text }], isError } });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stderr.end();
    this.onclose?.();
  }
}

const dataModule = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

test("Agency automatic startup and finish-pr lifecycle", async (t) => {
  globalThis.__agencyTestTransport = Transport;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@modelcontextprotocol/sdk/client/stdio.js") {
        return dataModule("export const StdioClientTransport = globalThis.__agencyTestTransport;");
      }
      if (specifier === "@modelcontextprotocol/sdk/client/index.js") {
        return { url: sdkClientUrl, shortCircuit: true };
      }
      if (specifier === "typebox") return dataModule("export const Type = { Unsafe: x => x };");
      if (specifier === "@earendil-works/pi-coding-agent") return dataModule(`
        export const DEFAULT_MAX_BYTES = 50000, DEFAULT_MAX_LINES = 2000;
        export const formatSize = String;
        export const truncateHead = content => ({ content, truncated: false });
      `);
      return nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis.__agencyTestTransport; });
  const initialize = (await import("../agency-mcp.ts")).default;
  async function runtime(t, probeResult = { code: 0, killed: false }, mode = "normal") {
    Transport.mode = mode;
    const events = new Map(), tools = new Map(), commands = new Map();
    const notices = [], probes = [];
    const ctx = { cwd: tmpdir(), hasUI: true, ui: {
      notify: (message, level) => notices.push({ message, level }), setStatus() {},
    } };
    // No registerFlag/getFlag: auto-start must not depend on a CLI switch.
    initialize({
      exec: async (command, args, options) => {
        probes.push({ command, args, options });
        assert.equal(command, "agency");
        assert.deepEqual(args, ["--version"]);
        assert.deepEqual(options, { timeout: 5000 });
        return typeof probeResult === "function" ? probeResult() : probeResult;
      },
      on: (name, handler) => events.set(name, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (name, command) => commands.set(name, command),
    });
    assert.equal(probes.length, 0, "factory must not spawn processes");
    assert.equal(tools.size, 0, "tools must wait for CLI detection and connection");
    const shutdown = () => events.get("session_shutdown")();
    const start = () => events.get("session_start")({}, ctx);
    t.after(shutdown);
    await start();
    const call = (args = {}, signal, onUpdate, overrides = {}) => tools.get("agency_call_tool").execute(
      "test", { toolset_id: "finish-pr", tool_name: "finish_pull_request", arguments: args, ...overrides },
      signal, onUpdate, ctx,
    );
    return { call, tools, ctx, shutdown, start, notices, probes, events, commands };
  }

  for (const result of [{ code: 1, killed: false }, { code: 2, killed: false }, { code: 0, killed: true }]) {
    await t.test(`unavailable CLI quietly skips Gateway: ${JSON.stringify(result)}`, async (t) => {
      const before = Transport.instances.length;
      const r = await runtime(t, result);
      assert.equal(r.probes.length, 1);
      assert.equal(r.tools.size, 0);
      assert.equal(Transport.instances.length, before);
      assert.deepEqual(r.notices, []);
      assert.equal(r.events.get("before_agent_start")({ systemPrompt: "base" }), undefined);
      await r.commands.get("agency-status").handler("", r.ctx);
      assert.match(r.notices.at(-1).message, /CLI is unavailable/);
      assert.doesNotMatch(r.notices.at(-1).message, /--agency/);
    });
  }

  await t.test("working CLI connects automatically; other calls retain Gateway routing", async (t) => {
    const before = Transport.instances.length;
    const r = await runtime(t);
    assert.equal(r.probes.length, 1);
    assert.ok(r.tools.has("agency_call_tool"));
    assert.match(r.events.get("before_agent_start")({ systemPrompt: "base" }).systemPrompt, /^base\n\n## Agency/);
    await r.commands.get("agency-status").handler("", r.ctx);
    assert.match(r.notices.at(-1).message, /Gateway is connected/);
    for (const overrides of [{ toolset_id: "ado" }, { tool_name: "other_tool" }, { toolset_id: "finish-pr-custom" }]) {
      assert.match((await r.call({}, undefined, undefined, overrides)).content[0].text, /through gateway/);
    }
    assert.equal(Transport.instances.length, before + 1);
  });

  await t.test("startup rechecks availability after the CLI is installed", async (t) => {
    let code = 1;
    const r = await runtime(t, () => ({ code, killed: false }));
    assert.equal(r.tools.size, 0);
    code = 0;
    await r.start();
    assert.equal(r.probes.length, 2);
    assert.ok(r.tools.has("agency_call_tool"));
  });

  await t.test("connection failure is reported, not mistaken for a missing CLI", async (t) => {
    const r = await runtime(t, { code: 0, killed: false }, "gateway-error");
    assert.equal(r.tools.size, 0);
    assert.equal(r.events.get("before_agent_start")({ systemPrompt: "base" }), undefined);
    assert.match(r.notices.at(-1).message, /sign-in failed/);
    assert.equal(r.notices.at(-1).level, "error");
    assert.equal(Transport.instances.at(-1).closed, true);
    await r.commands.get("agency-status").handler("", r.ctx);
    assert.match(r.notices.at(-1).message, /CLI is available but/);
  });

  for (const args of [{}, { pull_request: "123", dry_run: true, interval_seconds: 120, max_wait_seconds: 3600 }]) {
    await t.test(`heartbeats survive 180s and 30m; arguments ${JSON.stringify(args)}`, async (t) => {
      const { call, ctx } = await runtime(t);
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
      const updates = [];
      let outcome;
      const pending = call(args, undefined, (update) => updates.push(update))
        .then(value => { outcome = { value }; }, error => { outcome = { error }; });
      await flush();
      const watcher = Transport.instances.at(-1);
      assert.deepEqual(watcher.options.args, ["mcp", "finish-pr"]);
      assert.equal(watcher.options.command, "agency");
      assert.equal(watcher.options.cwd, ctx.cwd);
      assert.equal(watcher.request.params.name, "finish_pull_request");
      assert.deepEqual(watcher.request.params.arguments, args);
      for (let seconds = 30; seconds <= (args.max_wait_seconds ? 1950 : 1800); seconds += 30) {
        t.mock.timers.tick(30_000);
        watcher.progress(seconds);
        await flush();
        assert.equal(outcome, undefined, `watch ended prematurely at ${seconds}s`);
      }
      assert.match(updates.at(-1).content[0].text, /Watching PR/);
      watcher.reply("Nothing needs you yet. Call again to keep waiting.");
      await pending;
      assert.ifError(outcome.error);
      assert.match(outcome.value.content[0].text, /Nothing needs you/);
      assert.equal(watcher.closed, true);
    });
  }

  for (const mode of ["normal", "ping-error"]) {
    await t.test(`Windows transport pings: ${mode}`, { skip: process.platform !== "win32" }, async (t) => {
      const { call } = await runtime(t);
      Transport.mode = mode;
      t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
      const updates = [];
      let outcome;
      const pending = call({}, undefined, update => updates.push(update))
        .then(value => { outcome = { value }; }, error => { outcome = { error }; });
      await flush();
      const watcher = Transport.instances.at(-1);
      t.mock.timers.tick(1000);
      await flush();
      assert.equal(watcher.messages.filter(message => message.method === "ping").length, 1);
      assert.deepEqual(updates.map(update => update.content[0].text), ["Connecting to Agency finish-pr…"],
        "transport pings must not synthesize Agency progress");
      if (mode === "ping-error") {
        assert.match(outcome?.error?.message ?? "", /transport ping refused/);
      } else {
        watcher.progress(30);
        await flush();
        assert.match(updates.at(-1).content[0].text, /Watching PR: 30s/);
        watcher.reply("Nothing needs you yet.");
      }
      await pending;
      assert.equal(watcher.closed, true);
      const messageCount = watcher.messages.length;
      t.mock.timers.tick(3000);
      await flush();
      assert.equal(watcher.messages.length, messageCount, "completion/failure must stop pings");
      const pingIds = new Set(watcher.messages.filter(message => message.method === "ping").map(message => message.id));
      assert.equal(watcher.messages.some(message => message.method === "notifications/cancelled" && pingIds.has(message.params.requestId)), false,
        "completed pings must not retain abort listeners and send stale cancellations");
    });
  }

  await t.test("silent backend times out, cancels and closes (no automatic retry)", async (t) => {
    const { call } = await runtime(t);
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const rejected = assert.rejects(call(), /Request timed out/);
    await flush();
    const count = Transport.instances.length, watcher = Transport.instances.at(-1);
    t.mock.timers.tick(120_001);
    await rejected;
    assert.equal(watcher.closed, true);
    assert.ok(watcher.messages.some(m => m.method === "notifications/cancelled"));
    assert.equal(Transport.instances.length, count);
  });

  await t.test("headless calls also request heartbeat and preserve terminal errors", async (t) => {
    const { call } = await runtime(t);
    for (const [text, isError] of [["PR merged", false], ["Fix review thread 1", false], ["PR was abandoned", true]]) {
      const pending = call();
      const checked = isError ? assert.rejects(pending, /abandoned/) : pending;
      await flush();
      const watcher = Transport.instances.at(-1);
      watcher.progress(30);
      await flush();
      watcher.reply(text, isError);
      const result = await checked;
      if (!isError) assert.equal(result.content[0].text, text);
      assert.equal(watcher.closed, true);
    }
  });

  for (const mode of ["normal", "handshake-held"]) {
    await t.test(`abort during ${mode} closes its backend`, async (t) => {
      const { call } = await runtime(t);
      Transport.mode = mode;
      const controller = new AbortController();
      const rejected = assert.rejects(call({}, controller.signal), /cancelled/);
      await flush();
      const watcher = Transport.instances.at(-1);
      controller.abort(new Error("cancelled"));
      await rejected;
      assert.equal(watcher.closed, true);
      assert.ok(watcher.messages.some(m => m.method === "notifications/cancelled"));
    });
  }

  await t.test("invalid arguments and pre-abort never start a watcher", async (t) => {
    const { call } = await runtime(t);
    const count = Transport.instances.length;
    for (const args of [null, [], "bad"]) await assert.rejects(call(args), /must be an object/);
    const controller = new AbortController();
    controller.abort(new Error("cancelled before start"));
    await assert.rejects(call({}, controller.signal), /cancelled before start/);
    assert.equal(Transport.instances.length, count);
  });

  for (const mode of ["handshake-error", "spawn-error"]) {
    await t.test(`${mode} is reported and cleaned up`, async (t) => {
      const { call } = await runtime(t);
      Transport.mode = mode;
      await assert.rejects(call(), mode === "spawn-error" ? /executable missing/ : /sign-in failed[\s\S]*backend diagnostic/);
      assert.equal(Transport.instances.at(-1).closed, true);
    });
  }

  if (process.env.PI_FINISH_PR_STDIO_PROBE === "1") {
    await t.test("real stdio child survives 185 seconds and closes on completion/cancel", async (t) => {
      const { call } = await runtime(t);
      Transport.mode = "real-stdio";
      const started = Date.now(), updates = [];
      const result = await call({ dry_run: true }, undefined, update => updates.push(update));
      assert.ok(Date.now() - started >= 185000);
      assert.match(result.content[0].text, /handoff after 185 seconds/);
      assert.ok(updates.length >= 7);
      assert.equal(Transport.instances.at(-1).pid, null, "child must exit after handoff");
      const controller = new AbortController();
      let ready;
      const watching = new Promise(resolve => { ready = resolve; });
      const rejected = assert.rejects(call({}, controller.signal, update => {
        if (update.content[0].text === "fixture watching") ready();
      }), /cancelled/);
      await watching;
      controller.abort(new Error("cancelled"));
      await rejected;
      assert.equal(Transport.instances.at(-1).pid, null, "cancel must reap the child");
    });
  }

  await t.test("shutdown cancels all watchers and is idempotent", async (t) => {
    const { call, shutdown } = await runtime(t);
    const waits = [assert.rejects(call(), /closed/i), assert.rejects(call(), /closed/i)];
    await flush();
    const watchers = Transport.instances.slice(-2);
    await shutdown();
    await Promise.all(waits);
    await shutdown();
    assert.ok(watchers.every(watcher => watcher.closed));
    await assert.rejects(call(), /disconnected/i);
  });
});
