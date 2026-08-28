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
  pi.registerFlag("agency", {
    description: "Enable all Agency MCP toolsets through the Agency MCP Gateway",
    type: "boolean",
    default: false,
  });

  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let connectPromise: Promise<void> | undefined;
  let connectedToolCount = 0;
  let stderrTail = "";

  const enabled = () => pi.getFlag("agency") === true;

  const closeClient = async () => {
    const currentClient = client;
    const currentTransport = transport;
    client = undefined;
    transport = undefined;
    connectPromise = undefined;
    connectedToolCount = 0;

    try {
      if (currentClient) await currentClient.close();
      else if (currentTransport) await currentTransport.close();
    } catch {
      // The proxy may already have exited. Shutdown must remain idempotent.
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
            async execute(_toolCallId, params, signal) {
              const activeClient = client;
              if (!activeClient) {
                throw new Error("Agency MCP is disconnected. Restart Pi with --agency.");
              }

              const result = await activeClient.callTool(
                { name: tool.name, arguments: params as Record<string, unknown> },
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
        ctx.ui.setStatus("agency-mcp", undefined);
      }
    })();

    try {
      await connectPromise;
    } finally {
      if (!client) connectPromise = undefined;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!enabled()) return;
    try {
      await connect(ctx);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.on("session_shutdown", closeClient);

  pi.registerCommand("agency-status", {
    description: "Show whether the opt-in Agency MCP Gateway integration is connected",
    handler: async (_args, ctx) => {
      if (!enabled()) {
        ctx.ui.notify("Agency is disabled. Start Pi with: pi --agency", "info");
        return;
      }
      ctx.ui.notify(
        client
          ? `Agency MCP Gateway is connected with ${connectedToolCount} tools.`
          : "Agency is enabled but the MCP connection is unavailable.",
        client ? "info" : "warning",
      );
    },
  });
}
