import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type, type TSchema } from "typebox";

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown> & { type: "object" };
}

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri?: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
  [key: string]: unknown;
}

const AGENCY_SYSTEM_PROMPT = `## Agency MCP Gateway

When Agency MCP Gateway tools are available:
- Treat supported Microsoft-internal links as actionable context. For an S360/Service360 link, load \`s360-breeze\` and use its tools with identifiers or keywords from the link. For an EngineeringHub/EngHub (sometimes called "endhub") or \`eng.ms\` link, load \`enghub\` and call its \`fetch\` tool with the exact URL.
- For other tasks that may have an Agency integration, use \`agency_search_tools\` or \`agency_list_categories\` before using a generic workaround or saying that the data is inaccessible.
- Follow the JIT workflow: discover a toolset, load only the needed toolset with \`agency_load_toolset\`, inspect the chosen tool with \`agency_get_tool_schema\`, then invoke it with \`agency_call_tool\`. Reuse the exact returned \`toolset_id\` and \`tool_name\`; never guess arguments or required fields.
- Prefer the specific Agency toolset over generic web or shell tools for the system it owns.`;

function cleanEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function toolSchema(tool: McpTool): TSchema {
  // Agency remains the source of truth for runtime argument validation.
  return Type.Unsafe(tool.inputSchema) as TSchema;
}

function stringifyContent(item: McpContent): string | undefined {
  if (item.type === "text" && typeof item.text === "string") return item.text;

  if (item.type === "resource" && item.resource) {
    const heading = item.resource.uri
      ? `[Agency resource: ${item.resource.uri}]`
      : "[Agency resource]";
    return typeof item.resource.text === "string"
      ? `${heading}\n${item.resource.text}`
      : `${heading}\n${JSON.stringify(item.resource)}`;
  }

  if (item.type === "audio") {
    return `[Agency returned ${item.mimeType || "audio"} content; audio data omitted]`;
  }

  return item.type === "image" ? undefined : JSON.stringify(item);
}

function formatResult(result: {
  content?: McpContent[];
  structuredContent?: unknown;
}): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  const content = result.content ?? [];
  const textParts = content
    .map(stringifyContent)
    .filter((value): value is string => typeof value === "string");

  if (result.structuredContent !== undefined) {
    textParts.push(JSON.stringify(result.structuredContent, null, 2));
  }

  const rawText = textParts.join("\n\n") || "Agency returned no textual content.";
  const truncated = truncateHead(rawText, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let text = truncated.content;
  if (truncated.truncated) {
    text +=
      `\n\n[Agency output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines` +
      ` (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}).]`;
  }

  const output: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text }];

  for (const item of content) {
    if (
      item.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string"
    ) {
      output.push({ type: "image", data: item.data, mimeType: item.mimeType });
    }
  }
  return output;
}

function resultErrorText(result: { content?: McpContent[] }): string {
  const text = (result.content ?? [])
    .map(stringifyContent)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return text || "Agency MCP tool call failed.";
}

export default function agencyMcpExtension(pi: ExtensionAPI) {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let connectPromise: Promise<void> | undefined;
  let connectedToolCount = 0;
  let stderrTail = "";
  const finishPrClients = new Set<Client>();

  let cliAvailable = false;

  const closeClient = async () => {
    const currentClient = client;
    const currentTransport = transport;
    client = undefined;
    transport = undefined;
    connectPromise = undefined;
    connectedToolCount = 0;

    // A stopped/reloaded session must not leave a PR watcher running.
    await Promise.all([...finishPrClients].map((watcher) => watcher.close().catch(() => {})));
    finishPrClients.clear();

    try {
      if (currentClient) await currentClient.close();
      else if (currentTransport) await currentTransport.close();
    } catch {
      // The proxy may already have exited. Shutdown must remain idempotent.
    }
  };

  // Gateway's backend HTTP call has a fixed 180s deadline. Keep discovery there,
  // but send this long-running call directly to the same Agency MCP over stdio.
  const callFinishPr = async (
    args: unknown,
    signal: AbortSignal | undefined,
    cwd: string,
    progress: (message: string) => void,
  ) => {
    signal?.throwIfAborted();
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("finish-pr arguments must be an object. Inspect its tool schema first.");
    }
    const watcher = new Client({ name: "pi-agency-finish-pr", version: "1.0.0" }, { capabilities: {} });
    const watcherTransport = new StdioClientTransport({
      command: "agency",
      args: ["mcp", "finish-pr"],
      cwd,
      env: cleanEnvironment(),
      stderr: "pipe",
    });
    let logs = "";
    watcherTransport.stderr?.on("data", (chunk) => {
      logs = (logs + String(chunk)).slice(-8_000);
    });
    const keepalive = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, keepalive.signal]) : keepalive.signal;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let pingPending = false;
    finishPrClients.add(watcher);
    try {
      progress("Connecting to Agency finish-pr…");
      await watcher.connect(watcherTransport, { signal });
      if (process.platform === "win32") {
        // Windows stdin inheritance can stall Git while MCP waits for input.
        // ponytail: remove pings when Agency closes stdin on async Git children.
        pingTimer = setInterval(() => {
          if (pingPending) return;
          pingPending = true;
          // Client close cancels pending pings without SDK-retained abort listeners.
          void watcher.ping({ timeout: 120_000 })
            .catch((error) => keepalive.abort(error))
            .finally(() => { pingPending = false; });
        }, 1_000);
      }
      return await watcher.callTool(
        { name: "finish_pull_request", arguments: args as Record<string, unknown> },
        undefined,
        {
          signal: requestSignal,
          // This is a silence timeout, not a wall-clock limit. Agency emits a
          // heartbeat every 30s and enforces max_wait_seconds itself (default 1800).
          timeout: 120_000,
          resetTimeoutOnProgress: true,
          onprogress: ({ message }) => progress(message ?? "Agency is still watching the PR…"),
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(logs.trim() ? `${message}\n${logs.trim()}` : message);
    } finally {
      clearInterval(pingTimer);
      keepalive.abort();
      finishPrClients.delete(watcher);
      await watcher.close().catch(() => {});
    }
  };

  const connect = async (ctx: {
    hasUI: boolean;
    ui: {
      notify(message: string, level?: "info" | "warning" | "error"): void;
      setStatus(key: string, value: string | undefined): void;
    };
  }) => {
    if (client) return;
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
      ctx.ui.setStatus("agency-mcp", "Agency: connecting…");
      stderrTail = "";

      const nextTransport = new StdioClientTransport({
        command: "agency",
        args: ["mcp", "gateway"],
        env: cleanEnvironment(),
        stderr: ctx.hasUI ? "pipe" : "inherit",
      });
      transport = nextTransport;
      nextTransport.stderr?.on("data", (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-8_000);
      });

      const nextClient = new Client(
        { name: "pi-agency", version: "1.0.0" },
        { capabilities: {} },
      );

      try {
        await nextClient.connect(nextTransport);
        client = nextClient;

        const response = await nextClient.listTools();
        const tools = response.tools as McpTool[];
        for (const tool of tools) {
          pi.registerTool({
            // Gateway names are deliberately scoped, so no Agency capability is
            // lost when another extension already owns a generic MCP tool name.
            name: `agency_${tool.name}`,
            label: `Agency · ${tool.name}`,
            description: tool.description || `Call the Agency MCP tool ${tool.name}`,
            parameters: toolSchema(tool),
            async execute(_toolCallId, params, signal, onUpdate, ctx) {
              const activeClient = client;
              if (!activeClient) {
                throw new Error("Agency MCP is disconnected. Check /agency-status, then /reload.");
              }

              const request = params as Record<string, unknown>;
              const result = tool.name === "call_tool" &&
                request.toolset_id === "finish-pr" && request.tool_name === "finish_pull_request"
                ? await callFinishPr(request.arguments, signal, ctx.cwd, (message) => {
                    onUpdate?.({
                      content: [{ type: "text", text: message }],
                      details: { server: "agency", tool: "finish_pull_request" },
                    });
                  })
                : await activeClient.callTool(
                    { name: tool.name, arguments: request },
                    undefined,
                    signal ? { signal } : undefined,
                  );
              const typedResult = result as {
                content?: McpContent[];
                structuredContent?: unknown;
                isError?: boolean;
              };

              if (typedResult.isError) throw new Error(resultErrorText(typedResult));
              return {
                content: formatResult(typedResult),
                details: { server: "agency", tool: tool.name },
              };
            },
          });
        }

        connectedToolCount = tools.length;
        ctx.ui.setStatus("agency-mcp", "Agency connected");
        ctx.ui.notify(
          `Agency MCP Gateway connected (${connectedToolCount} tools; all toolsets available on demand).`,
          "info",
        );
      } catch (error) {
        await closeClient();
        const message = error instanceof Error ? error.message : String(error);
        const logs = stderrTail.trim();
        throw new Error(logs ? `Agency MCP connection failed: ${message}\n${logs}` : message);
      } finally {
        if (!client) ctx.ui.setStatus("agency-mcp", undefined);
      }
    })();

    try {
      await connectPromise;
    } finally {
      if (!client) connectPromise = undefined;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    cliAvailable = false;
    try {
      // Probe before starting a Gateway; machines without Agency stay quiet.
      const probe = await pi.exec("agency", ["--version"], { timeout: 5_000 });
      cliAvailable = probe.code === 0 && !probe.killed;
      if (!cliAvailable) return;
      await connect(ctx);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.on("before_agent_start", (event) => {
    if (!client) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${AGENCY_SYSTEM_PROMPT}` };
  });

  pi.on("session_shutdown", closeClient);

  pi.registerCommand("agency-status", {
    description: "Show Agency CLI availability and MCP Gateway connection status",
    handler: async (_args, ctx) => {
      if (!cliAvailable) {
        ctx.ui.notify("Agency CLI is unavailable. Install it or add it to PATH, then /reload.", "info");
        return;
      }
      ctx.ui.notify(
        client
          ? `Agency MCP Gateway is connected with ${connectedToolCount} tools.`
          : "Agency CLI is available but the MCP connection is unavailable. Try /reload.",
        client ? "info" : "warning",
      );
    },
  });
}
