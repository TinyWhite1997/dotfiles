import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "ai-toolkit", "revenuecat", "skills");

export default function revenuecatExtension(pi: ExtensionAPI) {
  pi.registerFlag("revenuecat", {
    description: "Enable the RevenueCat MCP server and official RevenueCat skills",
    type: "boolean",
    default: false,
  });

  const isEnabled = () => pi.getFlag("revenuecat") === true;

  // CLI flag values are available by session_start; Pi owns the connection lifecycle.
  pi.on("session_start", () => {
    if (!isEnabled()) return;
    pi.registerMcpServer("revenuecat", {
      url: process.env.PI_REVENUECAT_MCP_URL || "https://mcp.revenuecat.ai/mcp",
      exposure: "codemode",
      description: "RevenueCat apps, subscriptions, purchases, and revenue analytics",
    });
  });

  pi.on("resources_discover", async () => {
    if (isEnabled()) return { skillPaths: [SKILLS_DIR] };
  });

  pi.registerCommand("revenuecat-status", {
    description: "Show how to inspect the opt-in RevenueCat native MCP integration",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        isEnabled()
          ? "RevenueCat uses Pi's native MCP. Run /mcp for connection status or /mcp login revenuecat to sign in."
          : "RevenueCat is disabled. Start Pi with: pi --revenuecat",
        "info",
      );
    },
  });
}
