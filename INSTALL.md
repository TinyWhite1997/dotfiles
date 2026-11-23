# Windows: personal / work installation

Run from PowerShell (7 recommended). The two public entrypoints share `install.ps1`; no duplicated package/Dotbot logic.

```powershell
# Personal computer: common dotfiles + personal Pi/Copilot guidance.
.\install.personal.ps1

# Work computer: common dotfiles + work Pi/Copilot guidance.
.\install.work.ps1

# Already installed dotfiles? Only switch guidance and Hindsight MCP registrations:
.\install.work.ps1 -AgentsOnly
.\install.personal.ps1 -AgentsOnly
```

`install.ps1` alone defaults to **personal** for compatibility. Use `-DotbotArgs @('--only', 'link')` to pass explicit arguments to Dotbot. `-AgentsOnly` skips the shared winget package list and common Dotbot configuration, but still runs the guidance-only YAML and profile-specific MCP configuration. Work also ensures Dev Tunnels and the Hindsight adapter dependencies are installed. Python and the Dotbot submodule are required even in this mode.

## Exactly two guidance files

- `instructions/work.md`: work-machine guidance; Hindsight is enabled for work-related tasks only.
- `instructions/personal.md`: personal tasks; never use the work memory service.

Dotbot links DeepSeek Harness, Pi, and Copilot directly to the selected source file, at their native user-level paths:

- `~/.dsh/AGENTS.md`
- `~/.pi/agent/AGENTS.md`
- `~/.copilot/copilot-instructions.md`

[`install.conf-agents.yaml`](install.conf-agents.yaml) uses Dotbot's native `path: instructions/${DOTFILES_PROFILE}.md` expansion. The Windows installer sets this variable to its validated profile for the installation and restores the previous environment afterward. Both full installation and `-AgentsOnly` run this YAML. There are no generated guidance copies or duplicated work/personal YAML files.

Edit `instructions/work.md` or `instructions/personal.md` and the linked file immediately reflects the change; reload/restart the agent to reread its instructions. Rerun an installer only to **switch** which profile the link points to. Dotbot backs up existing regular files as `<file>.dotbot-backup.<timestamp>` and relinks existing symlinks without touching their targets. Windows requires Developer Mode or symlink privileges; there is no fallback to copying.

The Unix and MSYS2 YAML files use the same variable. Their entrypoints default it to `personal` and reject values other than `work`/`personal`. `DOTFILES_PROFILE=work ./install` (or `./install.msys2`) selects work guidance; this does not configure or clean up MCPs on those platforms. Direct Dotbot invocations must supply `DOTFILES_PROFILE` explicitly.

## Hindsight MCP by profile

The work installer installs the Dev Tunnels CLI and Hindsight adapter dependencies, then runs `scripts/configure-agents.mjs --profile work` to register the shared private memory service. It uses `~/.hindsight/client.json` when present, otherwise the live defaults in `hindsight/client.work.json`; no connection prompt or copied default is needed. It does not sign in, create host tasks, or require a remote connection during installation. See [hindsight/README.md](hindsight/README.md) for host setup and connection checks.

The personal installer runs `scripts/configure-agents.mjs --profile personal` to remove only registrations pointing to this dotfiles adapter, including registrations from an older checkout. It does not install Dev Tunnels or Hindsight adapter dependencies. The managed client files are:

| Client | User/global file |
| --- | --- |
| Claude Code | `~/.claude.json` |
| Codex | `~/.codex/config.toml` (`$env:CODEX_HOME/config.toml` when set) |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json` |
| Pi | `~/.pi/agent/mcp.json` |
| Legacy Cursor registration | `~/.cursor/mcp.json` |

Unrelated servers and settings are preserved. Work fails preflight on an independently configured entry named `hindsight`; Personal leaves it unchanged. Legacy Cursor registrations are cleanup-only in both profiles. Memory data, connection files, credentials and host scheduled tasks are not deleted or stopped. Full and `-AgentsOnly` installations both apply the selected MCP profile; pulling the repository alone does not change local MCP settings.

The configuration writer requires Node.js 22+ and `npm ci --prefix scripts`. Invalid JSON/TOML and symlinked MCP configuration files fail preflight before guidance is changed. Existing files get a first-install `.dotfiles-backup`; treat these backups as private. TOML values are preserved, but comments/formatting can change. Updates are atomic per file, not a transaction across clients; rerunning converges safely after an I/O failure.

Close clients while installing to avoid concurrent config writes. Restart DeepSeek Harness, Claude Code, Copilot and Codex, and `/reload` Pi afterward: an already-running session can still hold previous guidance or an MCP connection. No permissions or destructive-tool auto-approval settings are changed.

## Optional DeepSeek Harness web search

The [Copilot web search bundle](dsh/copilot-web-search/README.md) is stored in this repository and installed separately into a DSH profile. It reuses DSH or Pi Copilot credentials and the native `web_search` tool; `web_fetch` stays on DSH's HTTP provider. The common Dotbot installers do not change DSH profiles or credentials. See the bundle documentation for installation, compatibility, configuration and tests.

## Verification

```powershell
npm ci --prefix scripts
node --test scripts/configure-agents.test.mjs scripts/guidance.test.mjs
pwsh -NoProfile -File scripts/install.test.ps1
pwsh -NoProfile -File scripts/install-windows.test.ps1
```
