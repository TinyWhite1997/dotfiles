import { fileURLToPath } from 'node:url';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTokenSource, createTunnelFetch, validateConfig, readConnection } from './tunnel-auth.mjs';

// Bridge transports, not a hand-written list of tools: preserve MCP capabilities and notifications.
export async function bridge(remote, local, log = console.error) {
  let initializeId;
  remote.onmessage = message => {
    if (message.id === initializeId && typeof message.result?.protocolVersion === 'string') {
      remote.setProtocolVersion(message.result.protocolVersion);
    }
    void local.send(message).catch(() => log('[hindsight] Cannot write to MCP client.'));
  };
  remote.onerror = () => log('[hindsight] Remote transport error; check server/tunnel availability.');
  local.onerror = () => log('[hindsight] Invalid stdio message or client I/O error.');
  local.onmessage = message => {
    if (message.method === 'initialize') initializeId = message.id;
    void remote.send(message).catch(async () => {
      if ('method' in message && 'id' in message) {
        await local.send({
          jsonrpc: '2.0', id: message.id,
          error: { code: -32603, message: 'Hindsight request failed. Check server/tunnel status and devtunnel user login. Writes are not automatically retried after network failures.' },
        });
      }
    }).catch(() => log('[hindsight] Cannot deliver error to MCP client.'));
  };
  await remote.start();
  await local.start();
}

async function main() {
  const config = await readConnection({ path: process.argv[2] });
  const url = validateConfig(config);
  const tokens = createTokenSource(config.tunnelId);
  await tokens.get(); // Fail early with a useful login error, without contaminating stdout.
  const remote = new StreamableHTTPClientTransport(url, {
    fetch: createTunnelFetch(url, tokens, { apiKey: process.env.HINDSIGHT_API_KEY }),
  });
  const local = new StdioServerTransport();
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(0), 3000);
    deadline.unref();
    try { await remote.terminateSession(); } catch { /* best-effort session cleanup */ }
    await remote.close();
    await local.close();
    process.exit(0);
  }
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await bridge(remote, local);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(`[hindsight] ${error.message}`);
    process.exitCode = 1;
  });
}
