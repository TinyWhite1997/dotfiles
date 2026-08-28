/**
 * Claude-style two-line status line for pi.
 *
 * Mirrors ~/.claude/statusline-command.ps1:
 *   1. user | folder | git branch
 *   2. model | context progress
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
const BAR_WIDTH = 20;

function progressBar(percent: number): string {
	const bounded = Math.max(0, Math.min(100, percent));
	const filled = Math.round((bounded * BAR_WIDTH) / 100);
	return "▓".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return String(tokens);
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let refreshFooter: (() => void) | undefined;

	const install = (ctx: ExtensionContext) => {
		if (!enabled || ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const refresh = () => tui.requestRender();
			const unsubscribeBranch = footerData.onBranchChange(refresh);
			refreshFooter = refresh;

			return {
				dispose() {
					unsubscribeBranch();
					if (refreshFooter === refresh) refreshFooter = undefined;
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

					return [line1, line2].map((line) => truncateToWidth(line, width));
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("agent_settled", () => refreshFooter?.());

	pi.registerCommand("statusline", {
		description: "Toggle the Claude-style two-line status line (on/off)",
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
