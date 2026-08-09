/**
 * agency-hub — pi extension that masquerades a pi session as a Copilot CLI
 * session so it appears on the Agency Hub website and can be steered,
 * aborted, renamed, model-switched and approved from the browser.
 *
 * No agency-side changes required. Everything below is loopback HTTP against
 * the `agency hub run` daemon, using the wire contracts of:
 *   client/agency/src/session_hooks/server.rs        (inbound: hook/chat_event/interaction/keepalive)
 *   client/agency/src/session_manager/interaction_listener.rs (outbound: interaction/command/shutdown)
 *   client/agency/src/session_manager/ui_protocol.rs (typed interaction payloads)
 *
 * Why Copilot-shaped: the Hub UI enables the chat composer only for
 * `agentType === "copilot-cli"` (LocalSessionDetailPage.tsx), and agentType is
 * derived by the daemon from the hook payload shape (camelCase = Copilot).
 *
 * Prereq: `agency hub start`.
 * Optional: AGENCY_HUB_APPROVALS=1 to route pi tool calls through the Hub's
 * approval cards (blocks the tool until the browser answers).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

type DaemonStatus = { pid: number; nonce: string; hookPort: number; connection: string };

/** Mirrors `fs_utils::agency_dir()`: `~/.local/agency` on unix, `%LOCALAPPDATA%\agency` on Windows. */
function agencyDir(): string {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local && local.length > 0
      ? path.join(local, "agency")
      : path.join(os.homedir(), "AppData", "Local", "agency");
  }
  return path.join(os.homedir(), ".local", "agency");
}

const AGENCY_DIR = path.join(agencyDir(), "session-manager");
const STATUS_FILE = path.join(AGENCY_DIR, "daemon.status.json");
const SESSIONS_DIR = path.join(AGENCY_DIR, "sessions");
/** Relaunch records the daemon reads to honour a Hub Resume of a pi session. */
const EXTERNAL_DIR = path.join(AGENCY_DIR, "external-sessions");
/** Hub/Copilot-shaped JSONL sidecars served by daemon `eventLog.read`. */
const HISTORY_DIR = path.join(AGENCY_DIR, "external-history");
const KEEPALIVE_MS = 30_000;
const POST_TIMEOUT_MS = 5_000;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

const markerPath = (id: string) =>
  path.join(SESSIONS_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
const recordPath = (id: string) =>
  path.join(EXTERNAL_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
const historyPath = (id: string) =>
  path.join(HISTORY_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);

function readDaemon(): DaemonStatus | null {  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")) as DaemonStatus;
  } catch {
    return null;
  }
}

/** Flatten a pi message content (string | content blocks) to plain text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}

/** Reasoning/thinking blocks, rendered by the Hub as a collapsible section. */
function thinkingOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "thinking" && typeof c.thinking === "string")
    .map((c: any) => c.thinking)
    .join("");
}

/** Timestamp accepted by the Hub event-log reader. */
function eventTimestamp(entry: any, message: any): string {
  if (typeof entry?.timestamp === "string") return entry.timestamp;
  const ms = typeof message?.timestamp === "number" ? message.timestamp : Date.now();
  return new Date(ms).toISOString();
}

/**
 * Convert pi's durable message entries into the same event vocabulary emitted
 * live by this extension. Thinking blocks are deliberately omitted from cold
 * history: persisting hidden chain-of-thought into a browser-readable log is a
 * materially different privacy boundary from ephemeral live rendering.
 */
function seedEvents(entries: readonly any[]): any[] {
  const out: any[] = [];
  let parentId: string | null = null;
  const push = (type: string, data: Record<string, unknown>, id: string, timestamp: string) => {
    out.push({ type, data, id, timestamp, parentId });
    parentId = id;
  };

  for (const entry of entries) {
    if (entry?.type !== "message" || !entry.message) continue;
    const message = entry.message;
    const baseId = String(entry.id ?? randomUUID());
    const timestamp = eventTimestamp(entry, message);

    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) push("user.message", { content: text, text }, `${baseId}:user`, timestamp);
      continue;
    }

    if (message.role === "assistant") {
      const turnId = baseId;
      push("assistant.turn_start", { id: turnId }, `${baseId}:turn-start`, timestamp);
      const text = textOf(message.content);
      if (text) push("assistant.message", { id: turnId, text }, `${baseId}:message`, timestamp);
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type !== "toolCall") continue;
          push(
            "tool.execution_start",
            { callId: block.id, name: block.name, arguments: block.arguments ?? {} },
            `${baseId}:tool:${String(block.id ?? randomUUID())}`,
            timestamp
          );
        }
      }
      push("assistant.turn_end", { id: turnId }, `${baseId}:turn-end`, timestamp);
      continue;
    }

    if (message.role === "toolResult") {
      push(
        "tool.execution_complete",
        {
          callId: message.toolCallId,
          name: message.toolName,
          result: textOf(message.content),
          success: !message.isError,
          isError: !!message.isError,
        },
        `${baseId}:tool-result`,
        timestamp
      );
    }
  }
  return out;
}

/** Diagnostics: AGENCY_HUB_DEBUG=1 appends the full wire trace to a file. */
const DEBUG_LOG = process.env.AGENCY_HUB_DEBUG === "1" ? path.join(os.tmpdir(), "agency-hub-pi.log") : null;
function debug(line: string) {
  if (DEBUG_LOG) {
    try {
      fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* ignore */
    }
  }
}

export default function (pi: ExtensionAPI) {
  // pi-subagents marks every child process explicitly. Child sessions are
  // implementation details of the parent run: showing each one as a separate
  // Hub session floods the device list and makes Resume/steering semantics
  // ambiguous. Do not register any Agency handlers or write opt-in/relaunch
  // records for children. Nested children inherit the same marker.
  if (process.env.PI_SUBAGENT_CHILD === "1") {
    debug("subagent child detected; Agency Hub integration disabled");
    return;
  }

  let daemon: DaemonStatus | null = null;
  let sessionId = "";
  let cwd = process.cwd();
  let server: http.Server | null = null;
  let localPort = 0;
  const localNonce = randomUUID().replace(/-/g, "");
  let timer: NodeJS.Timeout | null = null;
  let ctxRef: ExtensionContext | null = null;

  /** Assistant streaming state: turn key + how much text/reasoning we shipped. */
  let stream: { id: string; sent: number; thought: number } | null = null;
  /** Texts injected by the Hub — suppress the duplicate transcript echo. */
  const injected = new Set<string>();
  /** Pending Hub approvals: requestId → resolve(behaviorKind). */
  const approvals = new Map<string, (kind: string) => void>();
  /** Parent chain for the Hub-compatible cold-history sidecar. */
  let lastHistoryEventId: string | null = null;

  const endpoint = () => ({ port: localPort, nonce: localNonce, pid: process.pid });

  async function post(route: string, body: unknown): Promise<void> {
    if (!daemon) return;
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/${route}/${daemon.nonce}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      debug(`-> ${route} ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    } catch (e) {
      debug(`-> ${route} ERR ${String(e)}`);
      /* daemon down / slow — never break the local session */
    }
  }

  /** Copilot-shaped lifecycle hook (camelCase → daemon registers as copilot-cli). */
  const hook = (hookEventName: string, extra: Record<string, unknown> = {}) =>
    post("hook", { hookEventName, sessionId, cwd, ...extra });

  /** Copilot `--ui-server`-shaped chat event; `endpoint` re-registers the reverse route. */
  const chat = async (eventType: string, data: Record<string, unknown>, messageId?: string) => {
    const timestamp = new Date().toISOString();
    const inner = { ...(messageId ? { messageId } : {}), ...data };

    // Persist the same vocabulary used by live delivery. The daemon's existing
    // bounded eventLog reader can then page this sidecar while pi is stopped,
    // with no pi-format knowledge in Rust.
    const eventId = randomUUID();
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.appendFileSync(
      historyPath(sessionId),
      `${JSON.stringify({
        type: eventType,
        data: inner,
        id: eventId,
        timestamp,
        parentId: lastHistoryEventId,
      })}\n`
    );
    lastHistoryEventId = eventId;

    await post("chat_event", {
      sessionId,
      event: {
        eventType,
        timestamp,
        ...(messageId ? { messageId } : {}),
        data: inner,
      },
      endpoint: endpoint(),
    });
  };

  /** Typed interaction (approval card) — daemon publishes it to the Hub. */
  const interaction = (request: unknown) =>
    post("interaction", { sessionId, request, endpoint: endpoint() });

  // ---------------------------------------------------------------- listener

  /** Commands the Hub can invoke on this session (`POST /command/{nonce}`). */
  async function runCommand(action: string, args: any, ctx: ExtensionContext): Promise<unknown> {
    switch (action) {
      case "abort":
        ctx.abort();
        return { aborted: true };

      case "name.set":
        pi.setSessionName(String(args?.name ?? ""));
        return { name: pi.getSessionName() };

      case "models.list":
        return {
          models: ctx.modelRegistry.getAvailable().map((m: any) => ({
            id: `${m.provider}/${m.id}`,
            name: m.name ?? m.id,
          })),
        };

      case "model.getCurrent":
        return ctx.model
          ? { modelId: `${(ctx.model as any).provider}/${(ctx.model as any).id}` }
          : {};

      case "model.switchTo": {
        const [provider, ...rest] = String(args?.modelId ?? "").split("/");
        const model = ctx.modelRegistry.find(provider, rest.join("/"));
        if (!model) throw new Error("unknown_model");
        if (!(await pi.setModel(model))) throw new Error("no_api_key");
        return { modelId: args.modelId };
      }

      case "metadata.contextInfo": {
        const usage: any = ctx.getContextUsage();
        return {
          usedTokens: usage?.tokens ?? 0,
          maxTokens: (ctx.model as any)?.contextWindow ?? 0,
        };
      }

      case "usage.getMetrics":
        return { usage: ctx.getContextUsage() ?? null };

      case "queue.pendingItems":
        return { items: ctx.hasPendingMessages() ? [{ text: "(queued)" }] : [] };

      case "history.compact":
        ctx.compact({});
        return { started: true };

      case "commands.list":
        return {
          commands: pi
            .getCommands()
            .map((c) => ({ name: c.name, description: c.description ?? "" })),
        };

      case "commands.invoke":
        pi.sendUserMessage(`/${args?.name ?? ""} ${args?.arg ?? ""}`.trim(), {
          deliverAs: ctx.isIdle() ? undefined : "steer",
        });
        return { invoked: true };

      case "mode.get":
        return { mode: "default" };

      default:
        throw new Error("unsupported_action");
    }
  }

  function startServer(ctx: ExtensionContext): Promise<void> {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          const [, route, nonce] = (req.url ?? "").split("/");
          const reply = (code: number, body: unknown) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
          };
          if (nonce !== localNonce) return reply(404, {});

          let p: any;
          try {
            p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reply(400, {});
          }

          // ---- steering + interaction answers ----------------------------
          if (route === "interaction") {
            if (p.kind === "send_message" && typeof p.text === "string") {
              try {
                injected.add(p.text);
                await chat("user.message", { text: p.text }, `u-${randomUUID()}`);
                pi.sendUserMessage(p.text, {
                  deliverAs: ctx.isIdle() ? undefined : "steer",
                });
                return reply(200, { ok: true, matched: true });
              } catch (e) {
                injected.delete(p.text);
                return reply(409, { ok: false, error: String(e) });
              }
            }
            if (p.kind === "permission" && typeof p.request_id === "string") {
              const done = approvals.get(p.request_id);
              if (!done) return reply(200, { ok: true, matched: false });
              approvals.delete(p.request_id);
              done(String(p.response?.kind ?? "reject"));
              return reply(200, { ok: true, matched: true });
            }
            // user_input / elicitation / exit_plan_mode: pi has no equivalent
            return reply(200, { ok: true, matched: false });
          }

          // ---- generic session commands ----------------------------------
          if (route === "command") {
            try {
              const data = await runCommand(String(p.action ?? ""), p.args ?? {}, ctx);
              return reply(200, { ok: true, data });
            } catch (e) {
              return reply(200, { ok: false, error: String((e as Error).message ?? e) });
            }
          }

          // ---- remote stop -------------------------------------------------
          if (route === "shutdown") {
            ctx.shutdown();
            return reply(200, { ok: true });
          }
          return reply(404, {});
        });
      });
      server.listen(0, "127.0.0.1", () => {
        localPort = (server!.address() as any).port;
        resolve();
      });
    });
  }

  // ------------------------------------------------------------- lifecycle

  async function unregister(reason: string) {
    if (!sessionId) return;
    if (timer) clearInterval(timer);
    timer = null;
    await hook("sessionEnd", { reason });
    try {
      fs.unlinkSync(markerPath(sessionId));
    } catch {
      /* best effort */
    }
    // Deliberately retain the external-session relaunch record. A normal exit
    // is precisely when the Hub's Resume action needs it. The daemon validates
    // that its executable/script still exist before using it; a later launch
    // of the same session atomically refreshes the record.
  }

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    // A /new, /resume or /fork replaces the session: retire the previous one.
    if (sessionId) await unregister("user_exit");

    daemon = readDaemon();
    if (!daemon) {
      ctx.ui?.notify?.("agency hub daemon not running — run `agency hub start`", "warn");
      return;
    }
    sessionId = ctx.sessionManager.getSessionId() ?? randomUUID();
    cwd = ctx.cwd;

    // Opt-in marker — the daemon's hooks are global and only reports sessions
    // that wrote one (equivalent to the `--hub` flag).
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(markerPath(sessionId), JSON.stringify({ pid: process.pid }));

    // Relaunch record: the daemon has no idea what pi is, so a Hub Resume of
    // this session would otherwise start Copilot against an id it never minted.
    // The daemon supplies the argv itself; we only say which program and where.
    fs.mkdirSync(EXTERNAL_DIR, { recursive: true });
    fs.writeFileSync(
      recordPath(sessionId),
      JSON.stringify({
        engine: "pi",
        // pi is a Node CLI, so the daemon relaunches it as `node <cli.js> …`.
        exe: process.execPath,
        script: process.argv[1],
        cwd,
      })
    );

    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const logPath = historyPath(sessionId);
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size === 0) {
      // Existing pi sessions predate this sidecar. On their first Resume,
      // seed the complete durable branch before appending new live activity.
      const seeded = seedEvents(ctx.sessionManager.getEntries() as readonly any[]);
      fs.writeFileSync(
        logPath,
        seeded.length ? `${seeded.map((event) => JSON.stringify(event)).join("\n")}\n` : ""
      );
      lastHistoryEventId = seeded.at(-1)?.id ?? null;
    } else {
      const lines = fs.readFileSync(logPath, "utf8").trimEnd().split("\n");
      try {
        lastHistoryEventId = JSON.parse(lines.at(-1) ?? "{}").id ?? null;
      } catch {
        lastHistoryEventId = null;
      }
    }

    if (!server) await startServer(ctx);
    await hook("sessionStart", { source: "startup", agentName: "pi" });
    // First event carrying `endpoint` — this is what makes steering routable.
    await chat("session.metadata_changed", { workingDirectory: cwd });

    // A Resume click carries the prompt the user typed in the Hub composer.
    // The daemon can't inject it through pi's flags, so it hands it over in the
    // environment for us to replay as the session's first turn.
    const resumePrompt = process.env.AGENCY_HUB_RESUME_PROMPT;
    if (resumePrompt) {
      delete process.env.AGENCY_HUB_RESUME_PROMPT;
      injected.add(resumePrompt);
      await chat("user.message", { id: `u-${randomUUID()}`, text: resumePrompt }, `u-${randomUUID()}`);
      pi.sendUserMessage(resumePrompt);
    }

    timer = setInterval(
      () => void post("keepalive", { sessionId, endpoint: endpoint() }),
      KEEPALIVE_MS
    );
  });

  pi.on("message_start", async (event) => {
    if (!sessionId) return;
    if (event.message.role === "user") {
      const text = textOf(event.message.content);
      if (injected.delete(text)) {
        await hook("userPromptSubmitted", {});
        return; // already echoed when the Hub injected it
      }
      await hook("userPromptSubmitted", {});
      await chat("user.message", { id: `u-${randomUUID()}`, text }, `u-${randomUUID()}`);
    }
    if (event.message.role === "assistant") {
      stream = { id: `a-${randomUUID()}`, sent: 0, thought: 0 };
      // `assistant.turn_start` opens the stitched bubble; `data.id` is the
      // turn key the Hub stitches every later frame of this turn onto
      // (`turnKeyFromEvent` in useSessionManagerSocket.ts).
      await chat("assistant.turn_start", { id: stream.id }, stream.id);
    }
  });

  pi.on("message_update", async (event) => {
    if (!sessionId || !stream || event.message.role !== "assistant") return;
    const thinking = thinkingOf(event.message.content);
    if (thinking.length > stream.thought) {
      const delta = thinking.slice(stream.thought);
      stream.thought = thinking.length;
      await chat("assistant.reasoning_delta", { id: stream.id, deltaContent: delta }, stream.id);
    }
    const text = textOf(event.message.content);
    if (text.length <= stream.sent) return;
    const delta = text.slice(stream.sent);
    stream.sent = text.length;
    await chat("assistant.streaming_delta", { id: stream.id, deltaContent: delta }, stream.id);
  });

  pi.on("message_end", async (event) => {
    if (!sessionId || event.message.role !== "assistant" || !stream) return;
    const text = textOf(event.message.content);
    // `assistant.message` carries the canonical text (replaces the stitched
    // deltas), then `assistant.turn_end` flips the bubble to complete —
    // without it the Hub shows a permanent "Thinking…" spinner.
    if (text) await chat("assistant.message", { id: stream.id, text }, stream.id);
    await chat("assistant.turn_end", { id: stream.id }, stream.id);
    stream = null;
  });

  // ---------------------------------------------------------------- tools

  pi.on("tool_call", async (event, ctx) => {
    if (!sessionId || process.env.AGENCY_HUB_APPROVALS !== "1") return;
    const requestId = randomUUID();
    const input: any = event.input ?? {};
    const isShell = event.toolName === "bash";
    const decision = await new Promise<string>((resolve) => {
      approvals.set(requestId, resolve);
      void interaction({
        kind: "permission",
        session_id: sessionId,
        request: {
          requestId,
          toolCallId: event.toolCallId,
          permissionRequest: isShell
            ? {
                kind: "shell",
                intention: `pi wants to run a shell command`,
                fullCommandText: String(input.command ?? ""),
                commands: [],
              }
            : { kind: event.toolName, intention: `pi wants to run ${event.toolName}`, ...input },
        },
      });
      setTimeout(() => {
        if (approvals.delete(requestId)) resolve("timeout");
      }, APPROVAL_TIMEOUT_MS).unref?.();
    });
    if (decision === "reject") {
      return { block: true, reason: "Denied from the Agency Hub" };
    }
    // approve-once / approve-for-session / approve-permanently / timeout → run
    return undefined;
  });

  pi.on("tool_execution_start", async (event) => {
    if (!sessionId) return;
    await hook("preToolUse", { toolName: event.toolName, toolArgs: event.args, toolInput: event.args });
    await chat(
      "tool.execution_start",
      { callId: event.toolCallId, name: event.toolName, arguments: event.args },
      `t-${event.toolCallId}`
    );
  });

  pi.on("tool_execution_end", async (event) => {
    if (!sessionId) return;
    await hook("postToolUse", {
      toolName: event.toolName,
      toolResult: { resultType: event.isError ? "error" : "success" },
    });
    await chat(
      "tool.execution_complete",
      {
        callId: event.toolCallId,
        name: event.toolName,
        success: !event.isError,
        isError: !!event.isError,
        result: typeof event.result === "string" ? event.result : undefined,
      },
      `t-${event.toolCallId}`
    );
  });

  pi.on("agent_settled", async () => {
    if (sessionId) await hook("agentStop", {});
  });

  pi.on("session_shutdown", async () => {
    await unregister("user_exit");
    sessionId = "";
    server?.close();
    server = null;
  });

  // Hard-exit safety net: drop the opt-in marker so the daemon stops
  // reporting a session whose process is gone.
  process.on("exit", () => {
    if (sessionId) {
      try {
        fs.unlinkSync(markerPath(sessionId));
      } catch {
        /* best effort */
      }
    }
  });
}
