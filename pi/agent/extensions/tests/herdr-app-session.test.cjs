const assert = require("node:assert/strict");
const { test } = require("node:test");

test("Herdr app Pi session labels", async (t) => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  const initialize = (await import("../herdr-app-session.ts")).default;

  function setup(env = {}) {
    process.env = {
      ...originalEnv,
      HC_TERMINAL_ID: "t7",
      PI_SUBAGENT_CHILD: "0",
      PI_FABRIC_PARENT_RUN: "",
      ...env,
    };
    const events = new Map();
    const calls = [];
    const ctx = {
      mode: "tui",
      cwd: "C:\\repo",
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => "C:\\sessions\\session-1.jsonl",
      },
      ui: { notify() {} },
    };
    initialize({
      on: (event, handler) => events.set(event, handler),
      exec: async (command, args) => {
        calls.push([command, args]);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    return { calls, emit: (event, reason, custom = ctx) => events.get(event)?.({ reason }, custom) };
  }

  await t.test("records a root TUI session and clears it on explicit quit", async () => {
    const h = setup();
    await h.emit("session_start", "startup");
    assert.deepEqual(h.calls[0], ["hc", ["label", "t7",
      "herdr.pi.session_id=session-1",
      "herdr.pi.session_path=C:\\sessions\\session-1.jsonl",
      "herdr.pi.session_cwd=C:\\repo",
    ]]);
    await h.emit("session_shutdown", "quit");
    assert.deepEqual(h.calls[1], ["hc", ["label", "t7",
      "herdr.pi.session_id=", "herdr.pi.session_path=", "herdr.pi.session_cwd=",
    ]]);
  });

  await t.test("keeps labels for reload and restart recovery", async () => {
    const h = setup();
    await h.emit("session_start", "startup");
    await h.emit("session_shutdown", "reload");
    assert.equal(h.calls.length, 1);
  });

  await t.test("ignores headless and child sessions", async () => {
    const headless = setup();
    await headless.emit("session_start", "startup", { ...{
      mode: "rpc",
      sessionManager: { getSessionId: () => "x", getSessionFile: () => "x" },
      ui: { notify() {} },
    } });
    assert.deepEqual(headless.calls, []);

    const child = setup({ PI_SUBAGENT_CHILD: "1" });
    assert.equal(child.emit("session_start", "startup"), undefined);
    assert.deepEqual(child.calls, []);
  });
});
