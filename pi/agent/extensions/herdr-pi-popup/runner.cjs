const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");

let status = 1;
try {
	const [command, ...args] = JSON.parse(process.env.PI_HERDR_POPUP_ARGV ?? "[]");
	if (typeof command !== "string") throw new Error("PI_HERDR_POPUP_ARGV must contain a command");
	const env = { ...process.env, ...JSON.parse(process.env.PI_HERDR_POPUP_ENV ?? "{}") };

	const child = spawnSync(command, args, { stdio: "inherit", env });
	if (child.error) throw child.error;
	status = child.status ?? 1;
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
} finally {
	if (process.env.PI_HERDR_POPUP_STATUS) {
		writeFileSync(process.env.PI_HERDR_POPUP_STATUS, `${status}\n`);
	}
}

process.exitCode = status;
