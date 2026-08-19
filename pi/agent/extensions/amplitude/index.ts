import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type TSchema } from "typebox";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(
  EXTENSION_DIR,
  "mcp-marketplace",
  "plugins",
  "amplitude",
  "skills",
);
const DEFAULT_MCP_URL = "https://mcp.amplitude.com/mcp";
const MCP_URL = process.env.PI_AMPLITUDE_MCP_URL || DEFAULT_MCP_URL;
const require = createRequire(import.meta.url);

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

function isEnabled(pi: ExtensionAPI): boolean {
  // `amplititude` is intentionally supported because it is the requested CLI spelling.
  return pi.getFlag("amplititude") === true || pi.getFlag("amplitude") === true;
}

function mcpRemoteEntryPoint(): string {
  const packageJson = require.resolve("mcp-remote/package.json");
  return join(dirname(packageJson), "dist", "proxy.js");
}

function cleanEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function toolSchema(tool: McpTool): TSchema {
  // Keep the MCP server's full JSON Schema for the model. Type.Unsafe gives the
  // schema the TypeBox marker Pi needs; Amplitude remains the source of truth
  // for runtime argument validation.
  return Type.Unsafe(tool.inputSchema) as TSchema;
}

function stringifyContent(item: McpContent): string | undefined {
  if (item.type === "text" && typeof item.text === "string") return item.text;

  if (item.type === "resource" && item.resource) {
    const heading = item.resource.uri
      ? `[Amplitude resource: ${item.resource.uri}]`
      : "[Amplitude resource]";
    if (typeof item.resource.text === "string") {
      return `${heading}\n${item.resource.text}`;
    }
    return `${heading}\n${JSON.stringify(item.resource)}`;
  }

  if (item.type === "audio") {
    return `[Amplitude returned ${item.mimeType || "audio"} content; audio data omitted]`;
  }

  if (item.type !== "image") return JSON.stringify(item);
  return undefined;
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

  const rawText = textParts.join("\n\n") || "Amplitude returned no textual content.";
  const truncated = truncateHead(rawText, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let text = truncated.content;
  if (truncated.truncated) {
    text +=
      `\n\n[Amplitude output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines` +
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
  return text || "Amplitude MCP tool call failed.";
}

export default function amplitudeExtension(pi: ExtensionAPI) {
  pi.registerFlag("amplititude", {
    description: "Enable the Amplitude MCP server and official Amplitude skills",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("amplitude", {
    description: "Alias for --amplititude",
    type: "boolean",
    default: false,
  });

  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let connectPromise: Promise<void> | undefined;
  let connectedToolCount = 0;
  let stderrTail = "";

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
      ctx.ui.setStatus("amplitude-mcp", "Amplitude: connecting…");
      stderrTail = "";

      const nextTransport = new StdioClientTransport({
        command: process.execPath,
        args: [mcpRemoteEntryPoint(), MCP_URL],
        env: cleanEnvironment(),
        stderr: ctx.hasUI ? "pipe" : "inherit",
      });
      transport = nextTransport;

      nextTransport.stderr?.on("data", (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-8_000);
      });

      const nextClient = new Client(
        { name: "pi-amplitude", version: "1.0.0" },
        { capabilities: {} },
      );

      try {
        await nextClient.connect(nextTransport);
        client = nextClient;

        const response = await nextClient.listTools();
        const tools = response.tools as McpTool[];
        const collisions: string[] = [];

        for (const tool of tools) {
          const existing = pi.getAllTools().some((candidate) => candidate.name === tool.name);
          if (existing) {
            collisions.push(tool.name);
            continue;
          }

          pi.registerTool({
            name: tool.name,
            label: `Amplitude · ${tool.name}`,
            description: tool.description || `Call the Amplitude MCP tool ${tool.name}`,
            parameters: toolSchema(tool),
            async execute(_toolCallId, params, signal) {
              const activeClient = client;
              if (!activeClient) {
                throw new Error(
                  "Amplitude MCP is disconnected. Restart Pi with --amplititude.",
                );
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
                details: { server: "amplitude", tool: tool.name },
              };
            },
          });
        }

        connectedToolCount = tools.length - collisions.length;
        ctx.ui.setStatus("amplitude-mcp", `Amplitude: ${connectedToolCount} tools`);
        ctx.ui.notify(
          `Amplitude MCP connected (${connectedToolCount} tools, official skills enabled).`,
          "info",
        );
        if (collisions.length > 0) {
          ctx.ui.notify(
            `Skipped Amplitude tools whose names already exist: ${collisions.join(", ")}`,
            "warning",
          );
        }
      } catch (error) {
        await closeClient();
        const message = error instanceof Error ? error.message : String(error);
        const logs = stderrTail.trim();
        throw new Error(
          logs ? `Amplitude MCP connection failed: ${message}\n${logs}` : message,
        );
      } finally {
        ctx.ui.setStatus("amplitude-mcp", undefined);
      }
    })();

    try {
      await connectPromise;
    } finally {
      if (!client) connectPromise = undefined;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!isEnabled(pi)) return;

    try {
      await connect(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(message, "error");
    }
  });

  pi.on("resources_discover", async () => {
    if (!isEnabled(pi)) return;
    return { skillPaths: [SKILLS_DIR] };
  });

  pi.on("session_shutdown", closeClient);

  pi.registerCommand("amplitude-status", {
    description: "Show whether the opt-in Amplitude MCP integration is connected",
    handler: async (_args, ctx) => {
      if (!isEnabled(pi)) {
        ctx.ui.notify(
          "Amplitude is disabled. Start Pi with: pi --amplititude",
          "info",
        );
        return;
      }
      ctx.ui.notify(
        client
          ? `Amplitude MCP is connected with ${connectedToolCount} tools.`
          : "Amplitude is enabled but the MCP connection is unavailable.",
        client ? "info" : "warning",
      );
    },
  });
}
