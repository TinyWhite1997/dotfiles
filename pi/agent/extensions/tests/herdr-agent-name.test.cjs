const assert = require("node:assert/strict");
const { registerHooks } = require("node:module");
const { test } = require("node:test");

// Run the real extension with only the model and Herdr commands stubbed.
test("Herdr tab naming lifecycle", { timeout: 5000 }, async (t) => {
  const originalEnv = { ...process.env };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@earendil-works/pi-ai" || specifier === "@earendil-works/pi-ai/compat") {
        const source = `
          export const retryAssistantCall = (call) => call();
          export const uuidv7 = () => "naming-request";
          export const complete = async () => ({
            stopReason: "stop", content: [{ type: "text", text: "fix-tab-name" }],
          });
        `;
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  t.after(() => {
    hooks.deregister();
    process.env = originalEnv;
  });
  const initialize = (await import("../herdr-agent-name.ts")).default;
  const listTabs = ["tab", "list"];
  const resetTab = ["tab", "rename", "w1:t1", "2"];
  // Position is neither the opaque ID nor number, and excludes other workspaces.
  const tabOrder = [
    { tab_id: "w9:t1", workspace_id: "w9", number: 1, focused: true },
    { tab_id: "w1:t9", workspace_id: "w1", number: 9 },
    { tab_id: "w1:t1", workspace_id: "w1", number: 25 },
    { tab_id: "w1:tZ", workspace_id: "w1", number: 40 },
  ];
  const resetAgent = ["agent", "rename", "w1:p1", "pi"];
  const success = { code: 0, stdout: "", stderr: "" };

  function setup({ env = {}, branch = [], tabs = tabOrder, exec } = {}) {
    process.env = {
      ...originalEnv,
      HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_TAB_ID: "w1:t1",
      PI_SESSION_ID: "test-session", PI_SUBAGENT_CHILD: "0", PI_FABRIC_PARENT_RUN: "",
      ...env,
    };
    const events = new Map();
    const calls = [];
    const named = Promise.withResolvers();
    const ctx = {
      sessionManager: { getBranch: () => branch },
      modelRegistry: {
        find: () => ({}),
        getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
      },
      ui: { setStatus() {}, notify: (message) => named.resolve(message) },
    };
    initialize({
      on: (event, handler) => events.set(event, handler),
      exec: async (command, args, options) => {
        assert.equal(command, "herdr");
        calls.push(args);
        const result = await exec?.(args, options);
        if (result) return result;
        if (args[0] === "tab" && args[1] === "list") {
          return { ...success, stdout: JSON.stringify({ result: { tabs } }) };
        }
        if (args[0] === "agent" && args[1] === "list") {
          return { ...success, stdout: JSON.stringify({ result: { agents: [{
            pane_id: "w1:p1", name: "pi", agent_session: { value: "test-session" },
          }] } }) };
        }
        return success;
      },
    });
    return {
      calls, named: named.promise,
      emit: (event, reason) => events.get(event)?.({ reason, prompt: "Fix tab naming" }, ctx),
    };
  }

  await t.test("new restores the tab position, resets the agent, and names only the first prompt", async () => {
    const h = setup();
    await h.emit("session_start", "new");
    assert.deepEqual(h.calls, [listTabs, resetTab, resetAgent]);
    await h.emit("before_agent_start");
    assert.match(await h.named, /renamed to fix-tab-name/);
    assert.deepEqual(h.calls.at(-1), ["tab", "rename", "w1:t1", "fix-tab-name"]);
    const count = h.calls.length;
    await h.emit("before_agent_start");
    assert.equal(h.calls.length, count);
  });

  await t.test("quit restores only the tab position and is idempotent", async () => {
    const h = setup();
    await h.emit("session_shutdown", "quit");
    await h.emit("session_shutdown", "quit");
    assert.deepEqual(h.calls, [listTabs, resetTab, listTabs, resetTab]);
  });

  await t.test("new with seeded messages still restores the tab position", async () => {
    const h = setup({ branch: [{ type: "message", message: { role: "user" } }] });
    await h.emit("session_start", "new");
    assert.deepEqual(h.calls, [listTabs, resetTab]);
  });

  await t.test("startup, reload, resume, and fork preserve the label", async () => {
    for (const reason of ["startup", "reload", "resume", "fork"]) {
      const h = setup();
      if (reason !== "startup") await h.emit("session_shutdown", reason);
      await h.emit("session_start", reason);
      assert.deepEqual(h.calls, [], reason);
    }
  });

  await t.test("outside Herdr, missing tab, and child sessions do not rename", async () => {
    for (const env of [
      { HERDR_ENV: "0" }, { HERDR_TAB_ID: "" },
      { PI_SUBAGENT_CHILD: "1" }, { PI_FABRIC_PARENT_RUN: "parent-run" },
    ]) {
      const h = setup({ env });
      await h.emit("session_start", "new");
      await h.emit("before_agent_start");
      await h.emit("session_shutdown", "quit");
      assert.deepEqual(h.calls, []);
    }
  });

  await t.test("agent name conflict preserves the numeric tab label and falls back to clear", async () => {
    const h = setup({ exec: (args) => args[3] === "pi" ? { ...success, code: 1 } : undefined });
    await h.emit("session_start", "new");
    assert.deepEqual(h.calls, [listTabs, resetTab, resetAgent, ["agent", "rename", "w1:p1", "--clear"]]);
  });

  await t.test("tab list and reset errors are surfaced", async () => {
    for (const command of ["list", "rename"]) {
      const h = setup({ exec: (args) => args[1] === command
        ? { ...success, code: 1, stderr: "tab unavailable" } : undefined });
      await assert.rejects(h.emit("session_shutdown", "quit"), /tab unavailable/);
      if (command === "list") assert.deepEqual(h.calls, [listTabs]);
    }
  });

  await t.test("position is recomputed after another tab closes", async () => {
    const tabs = [...tabOrder];
    const h = setup({ tabs });
    await h.emit("session_shutdown", "quit");
    assert.deepEqual(h.calls.at(-1), resetTab);
    tabs.splice(1, 1);
    await h.emit("session_shutdown", "quit");
    assert.deepEqual(h.calls.at(-1), ["tab", "rename", "w1:t1", "1"]);
  });

  await t.test("invalid lists or a missing current tab never rename anything", async () => {
    for (const stdout of ["not JSON", "{}", JSON.stringify({ result: { tabs: [null] } }),
      JSON.stringify({ result: { tabs: [] } })]) {
      const h = setup({ exec: () => ({ ...success, stdout }) });
      await assert.rejects(h.emit("session_shutdown", "quit"));
      assert.deepEqual(h.calls, [listTabs]);
    }
  });

  for (const reason of ["quit", "new"]) {
    for (const stage of ["agent", "tab"]) {
      await t.test(`${reason} waits for an in-flight ${stage} rename before restoring the number`, async () => {
        const started = Promise.withResolvers();
        const release = Promise.withResolvers();
        const h = setup({
          exec: async (args, options) => {
            if (args[0] === stage && args[1] === "rename" && args[3] === "fix-tab-name") {
              started.resolve(options.signal);
              await release.promise; // Simulate a command completing despite cancellation.
            }
          },
        });
        await h.emit("session_start", "startup");
        await h.emit("before_agent_start");
        const signal = await started.promise;
        const stopping = h.emit("session_shutdown", reason);
        assert.equal(signal.aborted, true);
        assert.equal(h.calls.some((args) => args[0] === "tab" && args[3] === "2"), false);
        release.resolve();
        await stopping;
        const replacement = reason === "new" ? setup() : h;
        if (reason === "new") await replacement.emit("session_start", "new");
        const calls = reason === "new" ? [...h.calls, ...replacement.calls] : h.calls;
        assert.deepEqual(calls.filter((args) => args[0] === "tab").at(-1), resetTab);
        if (stage === "agent") {
          assert.equal(calls.some((args) => args[0] === "tab" && args[3] === "fix-tab-name"), false);
        }
      });
    }
  }
});
