import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLUGIN_ID = "pi.popup";
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

export const inHerdr = process.env.HERDR_ENV === "1" && process.platform !== "win32";

export function shQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runInHerdrPopup(
	pi: ExtensionAPI,
	opts: { command: string; cwd: string; timeoutMs?: number },
): Promise<{ status: number | null; error?: string }> {
	const ensured = await ensurePlugin(pi);
	if (ensured) return { status: null, error: ensured };

	const statusPath = join(tmpdir(), `pi-herdr-popup-${process.pid}-${Date.now()}`);
	rmSync(statusPath, { force: true });

	const opened = await pi.exec(
		"herdr",
		[
			"plugin",
			"pane",
			"open",
			"--plugin",
			PLUGIN_ID,
			"--entrypoint",
			"run",
			"--placement",
			"popup",
			"--width",
			"90%",
			"--height",
			"90%",
			"--focus",
			"--cwd",
			opts.cwd,
			"--env",
			`PI_HERDR_POPUP_CWD=${opts.cwd}`,
			"--env",
			`PI_HERDR_POPUP_CMD=${opts.command}`,
			"--env",
			`PI_HERDR_POPUP_STATUS=${statusPath}`,
		],
		{ timeout: 15_000 },
	);
	if (opened.code !== 0) {
		return {
			status: null,
			error: opened.stderr.trim() || opened.stdout.trim() || "herdr plugin pane open failed",
		};
	}

	try {
		await waitForFile(statusPath, opts.timeoutMs ?? 30 * 60 * 1000);
		const status = Number.parseInt(readFileSync(statusPath, "utf8").trim(), 10);
		return { status: Number.isFinite(status) ? status : null };
	} catch (error) {
		return { status: null, error: error instanceof Error ? error.message : String(error) };
	} finally {
		rmSync(statusPath, { force: true });
	}
}

async function ensurePlugin(pi: ExtensionAPI): Promise<string | undefined> {
	if (!existsSync(join(PLUGIN_DIR, "herdr-plugin.toml"))) {
		return `Herdr popup plugin missing at ${PLUGIN_DIR}`;
	}

	const listed = await pi.exec("herdr", ["plugin", "list", "--json"], { timeout: 10_000 });
	if (listed.code === 0) {
		try {
			const plugins = (JSON.parse(listed.stdout) as { result?: { plugins?: Array<{ plugin_id?: string; enabled?: boolean }> } })
				.result?.plugins;
			const current = plugins?.find((plugin) => plugin.plugin_id === PLUGIN_ID);
			if (current?.enabled) return;
			if (current && !current.enabled) {
				const enabled = await pi.exec("herdr", ["plugin", "enable", PLUGIN_ID], { timeout: 10_000 });
				if (enabled.code !== 0) return enabled.stderr.trim() || "herdr plugin enable failed";
				return;
			}
		} catch {
			// Fall through to link.
		}
	}

	const linked = await pi.exec("herdr", ["plugin", "link", PLUGIN_DIR, "--enabled"], { timeout: 15_000 });
	if (linked.code !== 0) return linked.stderr.trim() || "herdr plugin link failed";
}

function waitForFile(path: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			if (existsSync(path)) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > timeoutMs) {
				clearInterval(timer);
				reject(new Error("timed out waiting for Herdr popup to exit"));
			}
		}, 100);
	});
}
