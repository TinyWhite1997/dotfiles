import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { inHerdr, runInHerdrPopup } from "./herdr-pi-popup/popup.ts";

interface NeovimResult {
	status: number | null;
	error?: string;
}

const EMPTY_COMPONENT = { render: () => [], invalidate: () => {} };

class NeovimEditor extends CustomEditor {
	onNeovim?: () => void;

	override handleInput(data: string): void {
		if (matchesKey(data, "ctrl+g")) {
			this.onNeovim?.();
			return;
		}
		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		let editing = false;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new NeovimEditor(tui, theme, keybindings);
			editor.onNeovim = () => {
				if (editing) return;
				editing = true;
				void editPrompt(pi, ctx)
					.catch((error) => {
						ctx.ui.notify(`Unable to edit prompt: ${error instanceof Error ? error.message : String(error)}`, "error");
					})
					.finally(() => {
						editing = false;
					});
			};
			return editor;
		});
	});
}

async function editPrompt(pi: ExtensionAPI, ctx: ExtensionContext) {
	const directory = mkdtempSync(join(tmpdir(), "pi-neovim-"));
	const promptPath = join(directory, "prompt.md");
	const launchCwd = process.platform === "win32" ? process.cwd() : ctx.cwd;
	writeFileSync(promptPath, ctx.ui.getEditorText(), "utf8");

	try {
		const command = process.platform === "win32" ? "nvim.exe" : "nvim";
		const result = inHerdr
			? await runInHerdrPopup(pi, { command, args: [promptPath], cwd: launchCwd })
			: await runInCurrentTerminal(ctx, command, promptPath, launchCwd);

		if (!result) return;
		if (result.error) {
			ctx.ui.notify(`Unable to run Neovim: ${result.error}`, "error");
		} else if (result.status !== 0) {
			ctx.ui.notify(`Neovim exited with code ${result.status ?? "unknown"}`, "warning");
		} else {
			ctx.ui.setEditorText(readFileSync(promptPath, "utf8").replace(/^\uFEFF/, "").replace(/\r?\n$/, ""));
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function runInCurrentTerminal(
	ctx: ExtensionContext,
	command: string,
	promptPath: string,
	cwd: string,
): Promise<NeovimResult | undefined> {
	return ctx.ui.custom<NeovimResult>((tui, _theme, _keybindings, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");

		setTimeout(() => {
			let result: NeovimResult = { status: null };
			try {
				const child = spawnSync(command, [promptPath], {
					cwd,
					stdio: "inherit",
					env: { ...process.env, PWD: cwd },
				});
				result = { status: child.status, error: child.error?.message };
			} catch (error) {
				result.error = error instanceof Error ? error.message : String(error);
			} finally {
				tui.start();
				tui.requestRender(true);
				done(result);
			}
		}, process.platform === "win32" ? 100 : 0);

		return EMPTY_COMPONENT;
	});
}
