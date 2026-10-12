import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), "mcp-marketplace", "plugins", "amplitude", "skills",
);

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

  // Keep the original spelling as well as the correctly spelled alias.
  const isEnabled = () => pi.getFlag("amplititude") === true || pi.getFlag("amplitude") === true;

  // CLI flag values are available by session_start; Pi owns the connection lifecycle.
  pi.on("session_start", () => {
    if (!isEnabled()) return;
    pi.registerMcpServer("amplitude", {
      url: process.env.PI_AMPLITUDE_MCP_URL || "https://mcp.amplitude.com/mcp",
      exposure: "codemode",
      description: "Amplitude product analytics, events, cohorts, charts, and experiments",
    });
  });

  pi.on("resources_discover", async () => {
    if (isEnabled()) return { skillPaths: [SKILLS_DIR] };
  });

  pi.registerCommand("amplitude-status", {
    description: "Show how to inspect the opt-in Amplitude native MCP integration",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        isEnabled()
          ? "Amplitude uses Pi's native MCP. Run /mcp for connection status or /mcp login amplitude to sign in."
          : "Amplitude is disabled. Start Pi with: pi --amplititude (or --amplitude)",
        "info",
      );
    },
  });
}
