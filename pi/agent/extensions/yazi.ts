/*
 * Temporarily hand the terminal to yazi, then follow its selected directory
 * like the official `y` shell wrapper.
 *
 * Command:
 *   /yazi
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { inHerdr, runInHerdrPopup, shQuote } from "./herdr-pi-popup/popup.ts";

interface YaziResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	cwd?: string;
	error?: string;
	stderr?: string;
	logPath?: string;
}

type SessionSource = Pick<SessionManager, "getBranch" | "getSessionFile">;

const EMPTY_COMPONENT = { render: () => [], invalidate: () => {} };

function cloneSessionToCwd(source: SessionSource, cwd: string): string {
	const parentSession = source.getSessionFile();
	const target = SessionManager.create(cwd, undefined, {
		parentSession: parentSession && existsSync(parentSession) ? parentSession : undefined,
	});
	const sessionFile = target.getSessionFile();
	const header = target.getHeader();
	if (!sessionFile || !header) throw new Error("Unable to create a Pi session for the selected directory");

	writeFileSync(sessionFile, `${[header, ...source.getBranch()].map((entry) => JSON.stringify(entry)).join("\n")}\n`, {
		flag: "wx",
	});
	return sessionFile;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("yazi", {
		description: "Open yazi in a Herdr popup, or in this terminal if not in Herdr",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/yazi requires Pi's interactive TUI mode", "error");
				return;
			}

			// Native Windows executables cannot chdir to the MSYS path Pi may retain.
			const launchCwd = process.platform === "win32" ? process.cwd() : ctx.cwd;
			const cwdFile = join(tmpdir(), `pi-yazi-cwd-${process.pid}`);
			const stderrPath = join(tmpdir(), `pi-yazi-${process.pid}.log`);

			if (inHerdr) {
				rmSync(cwdFile, { force: true });
				const popup = await runInHerdrPopup(pi, {
					command: `yazi --cwd-file=${shQuote(cwdFile)}`,
					cwd: launchCwd,
				});
				const result: YaziResult = {
					status: popup.status,
					signal: null,
					error: popup.error,
					cwd: existsSync(cwdFile) ? readFileSync(cwdFile, "utf8") : undefined,
				};
				rmSync(cwdFile, { force: true });
				await followYaziCwd(ctx, result, launchCwd);
				return;
			}

			await ctx.waitForIdle();

			const result = await ctx.ui.custom<YaziResult>((tui, _theme, _keybindings, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				// Avoid racing Pi's pending Windows console read after tui.stop().
				setTimeout(() => {
					let runResult: YaziResult = { status: null, signal: null };
					let stderrFd: number | undefined;
					try {
						rmSync(cwdFile, { force: true });
						stderrFd = openSync(stderrPath, "w");
						const child = spawnSync(
							process.platform === "win32" ? "yazi.exe" : "yazi",
							[`--cwd-file=${cwdFile}`],
							{
								cwd: launchCwd,
								stdio: ["inherit", "inherit", stderrFd],
								env: { ...process.env, PWD: launchCwd },
							},
						);
						closeSync(stderrFd);
						stderrFd = undefined;
						runResult = {
							status: child.status,
							signal: child.signal,
							error: child.error?.message,
							stderr: readFileSync(stderrPath, "utf8").trim(),
							cwd: existsSync(cwdFile) ? readFileSync(cwdFile, "utf8") : undefined,
							logPath: stderrPath,
						};
						if (!runResult.error && !runResult.signal && runResult.status === 0) {
							rmSync(stderrPath, { force: true });
							runResult.logPath = undefined;
						}
					} catch (error) {
						runResult.error = error instanceof Error ? error.message : String(error);
					} finally {
						if (stderrFd !== undefined) {
							try {
								closeSync(stderrFd);
							} catch {}
						}
						try {
							rmSync(cwdFile, { force: true });
						} catch {}
						tui.start();
						tui.requestRender(true);
						done(runResult);
					}
				}, process.platform === "win32" ? 100 : 0);

				return EMPTY_COMPONENT;
			});

			await followYaziCwd(ctx, result, launchCwd);
		},
	});
}

async function followYaziCwd(ctx: ExtensionCommandContext, result: YaziResult, launchCwd: string) {
	if (result.error) {
		ctx.ui.notify(`Unable to run yazi: ${result.error}`, "error");
		return;
	}
	if (result.signal) {
		ctx.ui.notify(`yazi exited after signal ${result.signal}`, "warning");
		return;
	}
	if (result.status !== 0) {
		const detail = result.stderr ? `: ${result.stderr.slice(-1500)}` : "";
		const log = result.logPath ? ` (log: ${result.logPath})` : "";
		ctx.ui.notify(
			`yazi exited with code ${result.status ?? "unknown"}${detail}${log} (cwd: ${launchCwd})`,
			"warning",
		);
		return;
	}
	if (!result.cwd) return; // Yazi's Q key deliberately keeps the current directory.

	let selectedCwd: string;
	try {
		selectedCwd = resolve(result.cwd);
		if (!statSync(selectedCwd).isDirectory()) throw new Error("not a directory");
	} catch (error) {
		ctx.ui.notify(`Yazi returned an invalid directory (${result.cwd}): ${String(error)}`, "error");
		return;
	}

	const current = resolve(launchCwd);
	if (
		selectedCwd === current ||
		(process.platform === "win32" && selectedCwd.toLowerCase() === current.toLowerCase())
	) {
		return;
	}

	let sessionFile: string;
	try {
		// Pi sessions have immutable working directories, so resume a clone of
		// the active branch rooted at the directory selected in Yazi.
		sessionFile = cloneSessionToCwd(ctx.sessionManager, selectedCwd);
	} catch (error) {
		ctx.ui.notify(`Unable to change Pi directory: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}

	const switched = await ctx.switchSession(sessionFile, {
		withSession: async (nextCtx) => {
			try {
				process.chdir(selectedCwd);
			} catch (error) {
				nextCtx.ui.notify(`Pi changed directory, but process.chdir failed: ${String(error)}`, "warning");
			}
		},
	});
	if (switched.cancelled) rmSync(sessionFile, { force: true });
}
