# Private Hindsight MCP

```
Agent → stdio.mjs → HTTPS + tunnel connect token → private Dev Tunnel → Hindsight
```

No Agency, client-side forwarding port, anonymous tunnel access, or manually copied token. Node's MCP SDK handles Streamable HTTP/SSE; `devtunnel token` only issues credentials, never opens a forwarding connection.

For work/personal Windows installation and automatic registration in Pi, Copilot, Claude Code and Cursor, use [the profile installers](../INSTALL.md). Work connections are configured locally, not in this repository.

## Host configuration

- Hindsight API: `http://127.0.0.1:8888` (loopback only; no UI installed).
- Private tunnel: read `tunnelId` from `~/.hindsight/client.json`; port 8888, owner-only ACL.
- Shared bank: read `url` from the same local file; use the actual URL printed by `devtunnel host` plus `/mcp/shared/`.
- LLM: native `github-copilot` provider, `gpt-6-luna`; uses the host user's Copilot login, not Agency. Memory processing consumes Copilot allowance.
- Embeddings: local multilingual E5 ONNX; reranking: local FlashRank; database: embedded PostgreSQL (pg0). Models download on first launch.
- Host configuration, venv and logs live under `~/.hindsight/`; PostgreSQL data is at `~/.pg0/instances/hindsight/`, outside Git. Use a PostgreSQL dump or a stopped-instance backup before upgrades (do not copy a live data directory). Embedded PostgreSQL is for personal/development use, not HA.

## Add another client machine

Install Node.js 22+, Dev Tunnels CLI, and clone this repository. Sign in as the tunnel owner (connect tokens must be issued by a user with tunnel management rights):

```powershell
devtunnel user login
npm ci --prefix <repo>/hindsight
```

Create `~/.hindsight/client.json`:

```json
{
  "tunnelId": "<tunnel-id.cluster>",
  "url": "https://<host>-8888.<cluster>.devtunnels.ms/mcp/shared/"
}
```

Register this **stdio** MCP entry with your agent (use an absolute path):

```json
{
  "mcpServers": {
    "hindsight": {
      "command": "node",
      "args": ["<repo>/hindsight/stdio.mjs"]
    }
  }
}
```

For Copilot CLI, the equivalent is `copilot mcp add hindsight --timeout 180000 -- node <repo>/hindsight/stdio.mjs`. On Windows, `install.work.ps1 -AgentsOnly` registers all four clients while preserving other servers.

An optional second argument selects another client config file. If the Hindsight server also uses application API-key authentication, supply `HINDSIGHT_API_KEY` through your client's private environment/secret storage, not Git.

The agent owns the child process. There is no separate client daemon, localhost listener, or `devtunnel connect`. Merely connecting does not automatically save/retrieve conversations: agents must call `retain`/`sync_retain` and `recall`.

## Token lifecycle and safety

- Tokens stay in process memory, never stdout, config files or process arguments.
- Concurrent requests share one token acquisition. Before each HTTP request, refresh if within five minutes of the token's actual `exp`, including after laptop sleep. No idle polling is necessary.
- A 401/403 response invalidates the token and triggers one refresh/retry. Network failures and 5xx responses are **not** replayed, to avoid duplicate writes. An application-level auth rejection can also cause that one refresh, then fails.
- Refresh does not restart the MCP session; session ID, protocol version, capabilities and notifications pass through the SDK transports.
- Credentials are only sent to the configured HTTPS tunnel endpoint. Redirects are rejected, not followed.
- MFA, revoked login, unavailable tunnel, or expired tunnel resource still require operator action. Run `devtunnel user login` if needed; restart the MCP connection if startup failed. Remote server/session restarts may also require reconnecting MCP; requests are not silently replayed into a new session.
- The private tunnel is the network auth boundary. Do not make it anonymous or bind the unauthenticated API to a LAN/public interface. All clients with access share the bank's permissions, including delete tools; do not auto-approve destructive tools.

## Rebuild the Windows host

Prerequisites: Python 3.13, PowerShell 7, Node.js 22+, signed-in Copilot CLI and Dev Tunnels CLI. No Docker/WSL required.

```powershell
py -3.13 -m venv "$HOME/.hindsight/venv"
& "$HOME/.hindsight/venv/Scripts/python.exe" -m pip install -r ./hindsight/requirements.txt
Copy-Item ./hindsight/server.env.example "$HOME/.hindsight/.env"
npm ci --prefix hindsight
```

Create `client.json` as above. For a **new** tunnel, choose a unique ID and update `client.json` using the actual HTTPS URL printed by `host`; do not recreate the existing tunnel:

```powershell
devtunnel create <new-id> --expiration 30d
devtunnel port create <new-id.cluster> -p 8888 --protocol http
devtunnel access list <new-id.cluster>  # Must remain owner-only
```

Register/start two user-level Windows scheduled tasks:

```powershell
pwsh -NoProfile -File ./hindsight/register-host.ps1
```

`Hindsight-api` and `Hindsight-tunnel` start at user logon and restart after failures. They run under the signed-in user, not SYSTEM, so Copilot/Dev Tunnels can use that user's credentials. The host must remain awake and logged in. Existing tasks are not overwritten.

```powershell
Get-ScheduledTask -TaskName 'Hindsight-*'
Get-Content "$HOME/.hindsight/api.log" -Tail 30
Get-Content "$HOME/.hindsight/tunnel.log" -Tail 30
devtunnel access list <tunnel-id.cluster>
```

Logs are replaced on each service launch. To run in a terminal instead, use `run-service.ps1 -Service api` / `-Service tunnel` (do not run alongside the scheduled instances). Manage/renew the persistent tunnel with `devtunnel show` / `devtunnel update`; token renewal does not renew a deleted/expired tunnel resource.

To stop/unregister the host tasks (this keeps memory data and the tunnel):

```powershell
Get-ScheduledTask -TaskName 'Hindsight-api','Hindsight-tunnel' | Stop-ScheduledTask
Get-ScheduledTask -TaskName 'Hindsight-api','Hindsight-tunnel' | Unregister-ScheduledTask -Confirm:$false
```

## Checks

```powershell
npm test --prefix hindsight
node hindsight/smoke.mjs
# Optional: consumes LLM allowance; creates then deletes an isolated test bank:
node hindsight/smoke.mjs --memory
```

Tests use a controlled clock and a mock HTTP/SSE server to check expiry/concurrent refresh, bounded auth retries, redirect/credential safety, non-replay of ambiguous failures, and MCP session continuity across renewal. The default smoke check launches the actual stdio process and lists remote tools without modifying memories. `--memory` additionally verifies synchronous retain through the configured LLM and recall through embeddings/reranking, then deletes only its randomly named test bank. Before use, also verify an **unauthenticated** request to the tunnel is rejected/redirected rather than served by Hindsight.
