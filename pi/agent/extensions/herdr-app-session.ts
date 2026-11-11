import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const LABELS = {
  id: "herdr.pi.session_id",
  path: "herdr.pi.session_path",
  cwd: "herdr.pi.session_cwd",
};

export function sessionLabels(ctx: ExtensionContext): string[] {
  const sessionPath = ctx.sessionManager.getSessionFile();
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = ctx.cwd;
  return [
    `${LABELS.id}=${sessionId}`,
    `${LABELS.path}=${sessionPath}`,
    `${LABELS.cwd}=${cwd}`,
  ];
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_SUBAGENT_CHILD === "1" || process.env.PI_FABRIC_PARENT_RUN) return;

  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  let reported = false;

  async function setLabels(labels: string[], ctx?: ExtensionContext) {
    const result = await pi.exec("hc", ["label", terminal, ...labels], { timeout: 10_000 });
    if (result.code !== 0 && ctx) {
      ctx.ui.notify(`Herdr app session tracking failed: ${result.stderr.trim() || "hc label failed"}`, "warning");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    await setLabels(sessionLabels(ctx), ctx);
    reported = true;
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason !== "quit" || !reported) return;
    await setLabels(Object.values(LABELS).map((label) => `${label}=`));
  });
}
