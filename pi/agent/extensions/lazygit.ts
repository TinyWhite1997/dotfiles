/**
 * Temporarily hand the terminal to lazygit, then return to the same Pi session.
 *
 * Command:
 *   /lazygit
 */

import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface LazygitResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	error?: string;
}

const EMPTY_COMPONENT = { render: () => [], invalidate: () => {} };

export default function (pi: ExtensionAPI) {
	pi.registerCommand("lazygit", {
		description: "Open lazygit in the current directory and return to this Pi session on exit",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/lazygit requires Pi's interactive TUI mode", "error");
				return;
			}

			await ctx.waitForIdle();

			const result = await ctx.ui.custom<LazygitResult>((tui, _theme, _keybindings, done) => {
				let runResult: LazygitResult = { status: null, signal: null };

				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				try {
					const child = spawnSync(process.platform === "win32" ? "lazygit.exe" : "lazygit", [], {
						cwd: ctx.cwd,
						stdio: "inherit",
						env: process.env,
					});
					runResult = {
						status: child.status,
						signal: child.signal,
						error: child.error?.message,
					};
				} catch (error) {
					runResult.error = error instanceof Error ? error.message : String(error);
				} finally {
					tui.start();
					tui.requestRender(true);
					done(runResult);
				}

				return EMPTY_COMPONENT;
			});

			if (result.error) {
				ctx.ui.notify(`Unable to run lazygit: ${result.error}`, "error");
			} else if (result.signal) {
				ctx.ui.notify(`lazygit exited after signal ${result.signal}`, "warning");
			} else if (result.status !== 0) {
				ctx.ui.notify(`lazygit exited with code ${result.status ?? "unknown"}`, "warning");
			}
		},
	});
}
