const assert = require("node:assert/strict");
const { test } = require("node:test");

test("Pi restore candidate selection and command", async () => {
  const { LABELS, restoreCandidates, resumeCommand } = await import("./logic.mjs");
  const candidate = {
    address: "t1", state: "live", cwd: "C:\\fallback", labels: {
      [LABELS.path]: "C:\\sessions\\one.jsonl",
      [LABELS.cwd]: "C:\\repo's worktree",
    },
  };
  const remote = { ...candidate, address: "remote/t2" };
  const running = { ...candidate, address: "t3", report: { app: "pi" } };
  const unrelated = { address: "t4", state: "live", labels: {} };

  assert.deepEqual(restoreCandidates([candidate, remote, unrelated]), [candidate]);
  assert.deepEqual(restoreCandidates([candidate, running]), []);
  assert.equal(resumeCommand(candidate),
    "cd 'C:\\repo''s worktree'; pi --session 'C:\\sessions\\one.jsonl'");
});
