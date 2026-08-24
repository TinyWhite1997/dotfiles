/**
 * Temporarily hand the terminal to lazygit, then return to the same Pi session.
 *
 * Command:
 *   /lazygit
 */

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inHerdr, runInHerdrPopup } from "./herdr-pi-popup/popup.ts";

interface LazygitResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	error?: string;
	stderr?: string;
	logPath?: string;
}

const EMPTY_COMPONENT = { render: () => [], invalidate: () => {} };

export default function (pi: ExtensionAPI) {
	pi.registerCommand("lazygit", {
		description: "Open lazygit in a Herdr popup, or in this terminal if not in Herdr",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/lazygit requires Pi's interactive TUI mode", "error");
				return;
			}

			// Pi may retain an MSYS path such as /home/user/project in ctx.cwd,
			// which a native Windows executable cannot chdir to. Node's cwd is the
			// corresponding native path (for example C:\\msys64\\home\\...).
			const launchCwd = process.platform === "win32" ? process.cwd() : ctx.cwd;
			const launchEnv = { ...process.env };
			if (process.platform === "win32") {
				// Pi was launched from MSYS2, whose /usr/bin/git can report POSIX
				// worktree paths to native lazygit. Force Git for Windows instead.
				const windowsGitDir = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd");
				launchEnv.PATH = `${windowsGitDir};${process.env.PATH ?? ""}`;
				launchEnv.PWD = launchCwd;
			}

			if (inHerdr) {
				const result = await runInHerdrPopup(pi, {
					command: process.platform === "win32" ? "lazygit.exe" : "lazygit",
					args: process.platform === "win32" ? ["--path", launchCwd] : [],
					cwd: launchCwd,
					env:
						process.platform === "win32"
							? { PATH: launchEnv.PATH ?? "", PWD: launchCwd }
							: undefined,
				});
				reportLazygitResult(ctx, result, launchCwd);
				return;
			}

			await ctx.waitForIdle();

			const result = await ctx.ui.custom<LazygitResult>((tui, _theme, _keybindings, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				// Defer the spawn so Node has a chance to finish cancelling Pi's
				// pending console read after tui.stop(). Starting lazygit in this same
				// call stack can leave two readers racing on Windows console input.
				setTimeout(() => {
					let runResult: LazygitResult = { status: null, signal: null };
					const stderrPath = join(tmpdir(), `pi-lazygit-${process.pid}.log`);
					let stderrFd: number | undefined;
					try {
						stderrFd = openSync(stderrPath, "w");
						const child = spawnSync(
							process.platform === "win32" ? "lazygit.exe" : "lazygit",
							process.platform === "win32" ? ["--path", launchCwd] : [],
							{
								cwd: launchCwd,
								stdio: ["inherit", "inherit", stderrFd],
								env: launchEnv,
							},
						);
						closeSync(stderrFd);
						stderrFd = undefined;
						runResult = {
							status: child.status,
							signal: child.signal,
							error: child.error?.message,
							stderr: readFileSync(stderrPath, "utf8").trim(),
							logPath: stderrPath,
						};
					} catch (error) {
						runResult.error = error instanceof Error ? error.message : String(error);
					} finally {
						if (stderrFd !== undefined) closeSync(stderrFd);
						tui.start();
						tui.requestRender(true);
						done(runResult);
					}
				}, process.platform === "win32" ? 100 : 0);

				return EMPTY_COMPONENT;
			});

			reportLazygitResult(ctx, result, launchCwd);
		},
	});
}

function reportLazygitResult(
	ctx: { ui: { notify: (message: string, level: "error" | "warning") => void } },
	result: LazygitResult,
	launchCwd: string,
) {
	if (result.error) {
		ctx.ui.notify(`Unable to run lazygit: ${result.error}`, "error");
	} else if (result.signal) {
		ctx.ui.notify(`lazygit exited after signal ${result.signal}`, "warning");
	} else if (result.status !== 0) {
		const detail = result.stderr ? `: ${result.stderr.slice(-1500)}` : "";
		const log = result.logPath ? ` (log: ${result.logPath})` : "";
		ctx.ui.notify(
			`lazygit exited with code ${result.status ?? "unknown"}${detail}${log} (cwd: ${launchCwd})`,
			"warning",
		);
	}
}
