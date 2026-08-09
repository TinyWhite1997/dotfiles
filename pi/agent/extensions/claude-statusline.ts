/**
 * Claude-style three-line status line for pi.
 *
 * Mirrors ~/.claude/statusline-command.ps1:
 *   1. user | folder | git branch
 *   2. model | context progress
 *   3. local date/time
 *
 * Commands:
 *   /statusline        Toggle the custom status line
 *   /statusline on     Enable it
 *   /statusline off    Restore pi's default footer
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { userInfo } from "node:os";
import { basename } from "node:path";

const ICON_USER = "\uf007";
const ICON_FOLDER = "\uf07b";
const ICON_BRANCH = "\ue725";
const ICON_ROBOT = "\udb81\udea8";
const ICON_CLOCK = "\uf017";
const BAR_WIDTH = 20;

function progressBar(percent: number): string {
	const bounded = Math.max(0, Math.min(100, percent));
	const filled = Math.round((bounded * BAR_WIDTH) / 100);
	return "▓".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function formatDateTime(date: Date): string {
	const part = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} `
		+ `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return String(tokens);
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	const install = (ctx: ExtensionContext) => {
		if (!enabled || ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
			const clock = setInterval(() => tui.requestRender(), 1000);

			return {
				dispose() {
					clearInterval(clock);
					unsubscribeBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					const username = process.env.USERNAME || process.env.USER || userInfo().username;
					const folder = basename(ctx.cwd) || ctx.cwd;
					const branch = footerData.getGitBranch();

					let line1 = theme.fg("success", `${ICON_USER} ${username}`);
					line1 += "  " + theme.fg("accent", `${ICON_FOLDER} ${folder}`);
					if (branch) line1 += "  " + theme.fg("warning", `${ICON_BRANCH} ${branch}`);

					const model = ctx.model?.name || ctx.model?.id || "no model";
					let line2 = theme.fg("toolTitle", `${ICON_ROBOT} ${model}`);
					line2 += "  " + theme.fg("dim", `effort: ${ctx.thinkingLevel || "off"}`);

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
					if (contextWindow) {
						const contextSize = usage?.tokens == null
							? `ctx: ${formatTokens(contextWindow)}`
							: `ctx: ${formatTokens(usage.tokens)}/${formatTokens(contextWindow)}`;
						line2 += "  " + theme.fg("muted", contextSize);
					}
					if (usage?.percent != null) {
						const pct = Math.max(0, Math.min(100, usage.percent));
						const pctText = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
						line2 += "  " + theme.fg("accent", `[${progressBar(pct)}] ${pctText}%`);
					}

					const line3 = theme.fg("text", `${ICON_CLOCK} ${formatDateTime(new Date())}`);
					return [line1, line2, line3].map((line) => truncateToWidth(line, width));
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => install(ctx));

	pi.registerCommand("statusline", {
		description: "Toggle the Claude-style three-line status line (on/off)",
		handler: async (args, ctx) => {
			const choice = args.trim().toLowerCase();
			if (choice === "on") enabled = true;
			else if (choice === "off") enabled = false;
			else if (choice === "" || choice === "toggle") enabled = !enabled;
			else {
				ctx.ui.notify("Usage: /statusline [on|off]", "warning");
				return;
			}

			if (enabled) install(ctx);
			else ctx.ui.setFooter(undefined);
			ctx.ui.notify(`Claude-style status line ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

}
