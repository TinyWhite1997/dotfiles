const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const runner = join(__dirname, "runner.cjs");

test("runner preserves the child exit status", () => {
	for (const expected of [0, 7]) {
		const statusPath = join(tmpdir(), `pi-herdr-popup-test-${process.pid}-${expected}`);
		rmSync(statusPath, { force: true });
		const result = spawnSync(process.execPath, [runner], {
			env: {
				...process.env,
				PI_HERDR_POPUP_ARGV: JSON.stringify([process.execPath, "-e", `process.exit(${expected})`]),
				PI_HERDR_POPUP_STATUS: statusPath,
			},
		});
		assert.equal(result.status, expected);
		assert.equal(readFileSync(statusPath, "utf8"), `${expected}\n`);
		rmSync(statusPath);
	}
});
