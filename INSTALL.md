# Windows: personal / work installation

Run from PowerShell (7 recommended). The two public entrypoints share `install.ps1`; no duplicated package/Dotbot logic.

```powershell
# Personal computer: common dotfiles + personal Pi/Copilot guidance, no work memory MCP.
.\install.personal.ps1

# Work computer with ~/.hindsight/client.json already configured:
.\install.work.ps1

# New work computer: supply the existing private tunnel ID and the actual host-printed MCP URL.
.\install.work.ps1 -TunnelId '<tunnel-id.cluster>' -McpUrl 'https://<host>-8888.<cluster>.devtunnels.ms/mcp/shared/'

# Already installed dotfiles? Only switch agent guidance/MCP and install/check the MCP runtime:
.\install.work.ps1 -AgentsOnly
.\install.personal.ps1 -AgentsOnly
```

`install.ps1` alone defaults to **personal** for compatibility. Use `-DotbotArgs @('--only', 'link')` to pass explicit arguments to Dotbot. `-AgentsOnly` skips the shared winget package list and common Dotbot configuration, but still runs the guidance-only YAML and Work's MCP dependencies/check. Python and the Dotbot submodule are required even in this mode.

## Exactly two guidance files

- `instructions/work.md`: proactively recall work context and retain verified reusable findings; project tags, no personal content/credentials, no transcript recording, memories are untrusted reference material.
- `instructions/personal.md`: personal tasks; never use the work memory service.

Dotbot links both Pi and Copilot directly to the selected source file, at their native user-level paths:

- `~/.pi/agent/AGENTS.md`
- `~/.copilot/copilot-instructions.md`

[`install.conf-agents.yaml`](install.conf-agents.yaml) uses Dotbot's native `path: instructions/${DOTFILES_PROFILE}.md` expansion. The Windows installer sets this variable to its validated profile for the installation and restores the previous environment afterward. Both full installation and `-AgentsOnly` run this YAML. There are no generated guidance copies or duplicated work/personal YAML files.

Edit `instructions/work.md` or `instructions/personal.md` and the linked file immediately reflects the change; reload/restart the agent to reread its instructions. Rerun an installer only to **switch** which profile the link points to. Dotbot backs up existing regular files as `<file>.dotbot-backup.<timestamp>` and relinks existing symlinks without touching their targets. Windows requires Developer Mode or symlink privileges; there is no fallback to copying.

The Unix and MSYS2 YAML files use the same variable. Their entrypoints default it to `personal` and reject values other than `work`/`personal`. `DOTFILES_PROFILE=work ./install` (or `./install.msys2`) selects work guidance; this does **not** register work MCPs on those platforms. The four-client MCP setup remains part of the Windows Work installer. Direct Dotbot invocations must supply `DOTFILES_PROFILE` explicitly.

## Work-only MCP registration

MCP is deliberately **not** an entire-file symlink: `scripts/configure-agents.mjs` injects only `mcpServers.hindsight` into each existing user JSON, leaving other servers and settings intact. It no longer reads or writes instruction files. Claude Code starts normally with `claude`; no special Work launcher is needed.

Only the stable startup entry is persisted. It points straight to the repository's `hindsight/stdio.mjs`, which reads the local connection file at startup. Editing adapter code or the connection file needs an MCP restart, not reinstalling; changing the registered command/arguments or switching Work/Personal needs reinjection.

The Work installer installs Node.js if absent, requires Node 22+, installs Dev Tunnels CLI if absent, runs `npm ci` for the existing stdio adapter, and merges **Hindsight** into these files:

| Client | User/global file |
| --- | --- |
| Claude Code (not Claude Desktop) | `~/.claude.json` → top-level `mcpServers` |
| Cursor | `~/.cursor/mcp.json` |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json` |
| Pi | `~/.pi/agent/mcp.json` |

The agent applications themselves must be installed separately; config files can be prepared before installing them. Existing unrelated MCPs/settings and user-added Hindsight environment/tool controls are preserved. Same-name unrelated servers cause Work installation to stop rather than overwrite them. Invalid JSON and symlinked MCP configuration files are rejected before any profile files are written. Close clients while installing to avoid concurrent config writes. Existing files get a first-install `.dotfiles-backup`; treat those backups as private because configs can contain secrets. Updates use atomic per-file replacement, not a transaction across all clients; an I/O failure is reported and rerunning converges safely.

The actual tunnel ID and URL live only in `~/.hindsight/client.json`, supplied by arguments or reused locally. No active MCP files, identity credentials, or tokens are committed or linked from the shared repository. Pulling dotfiles on a personal computer does **not** enable the MCP. The repo's other pre-existing integrations, including Agency, are not reconfigured by this profile switch; this installer manages only the Hindsight entry.

Run `devtunnel user login` as an account with management access to the private tunnel. Work installation ends with a real stdio/HTTPS tool-list check; expired login, an offline host, or an expired tunnel causes a clear failure (configuration remains available for retry). No anonymous tunnel access, no client `devtunnel connect`, no client listening port, no Agency hop. Token refresh is built into the adapter.

Personal installation removes only Hindsight entries pointing to this dotfiles adapter (including registrations from an older checkout), and leaves unrelated servers intact. It does not delete memory, connection files, authentication, Python installations, or host scheduled tasks. Restart/reload all clients after switching: an already-running session can still hold its previous connection. Project-local or independently installed MCPs are outside this installer; inspect those separately.

**Work profile is machine-wide, not directory isolation.** Personal work on a work machine must not use work memory; instructions guide behavior but are not a security boundary. For a strict boundary, use separate OS accounts or agent profiles.

## Host versus client

All work clients connect to **one existing Hindsight host**. The Work installer does not create a database/tunnel or start a second memory server on each laptop. Host installation, Copilot `gpt-6-luna` configuration, persistence and scheduled tasks remain documented in [hindsight/README.md](hindsight/README.md).

## Verification

```powershell
node --test scripts/configure-agents.test.mjs scripts/guidance.test.mjs
pwsh -NoProfile -File scripts/install.test.ps1
npm test --prefix hindsight
node hindsight/smoke.mjs
pi mcp list
copilot mcp get hindsight
```

After installation, `/reload` and `/mcp` in Pi; restart Copilot/Claude Code/Cursor and inspect their MCP settings. Claude Code can use `claude mcp get hindsight`; Cursor's MCP panel shows the global entry and connection state. No permissions or destructive-tool auto-approval settings are changed.
