const assert = require("node:assert/strict");
const { registerHooks } = require("node:module");
const { test } = require("node:test");

// Exercise the real factory without loading Pi's model clients or running hooks.
test("Herdr naming skips pi-subagents and Fabric children", async (t) => {
  const originalEnv = { ...process.env };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@earendil-works/pi-ai" || specifier === "@earendil-works/pi-ai/compat") {
        const source = 'function unexpected() { throw new Error("Unexpected model call"); } export { unexpected as retryAssistantCall, unexpected as uuidv7, unexpected as complete };';
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

  for (const [label, subagent, fabric, actor, skipped] of [
    ["main", undefined, undefined, undefined, false],
    ["empty markers", "0", "", undefined, false],
    ["pi-subagents", "1", undefined, undefined, true],
    ["Fabric worker", undefined, "run-1", undefined, true],
    ["Fabric actor", undefined, "run-2", "actor-1", true],
    ["nested child", "1", "run-3", undefined, true],
  ]) {
    await t.test(label, () => {
      for (const [key, value] of Object.entries({
        PI_SUBAGENT_CHILD: subagent,
        PI_FABRIC_PARENT_RUN: fabric,
        PI_FABRIC_ACTOR_ID: actor,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      const registered = [];
      const exitHandlers = new Set(process.listeners("exit"));
      try {
        initialize({ on: (event) => registered.push(event) });
        if (skipped) {
          assert.deepEqual(registered, [], "child registered Pi hooks");
          assert.equal(process.listenerCount("exit"), exitHandlers.size, "child registered exit hook");
        } else {
          assert.ok(registered.includes("session_start"), "main integration disabled");
        }
      } finally {
        for (const handler of process.listeners("exit")) {
          if (!exitHandlers.has(handler)) process.off("exit", handler);
        }
      }
    });
  }
});
