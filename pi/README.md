# Pi configuration

This directory contains the Pi extensions managed by Dotbot.

## Managed extensions

- `agency-mcp.ts` — automatic Agency MCP Gateway integration when the CLI is available
- `claude-statusline.ts`
- `copilot-web-search.ts` (`web_search` via Copilot plus a direct, SSRF-guarded, token-efficient `web_fetch`)
- `herdr-agent-name.ts` (inside Herdr, uses `github-copilot/gpt-5.6-luna` to derive a unique live-agent name from the session's first prompt)
- `lazygit.ts` (`/lazygit` temporarily opens lazygit in the current directory, then returns to the same Pi session)
- `neovim.ts` (`Ctrl+G` edits the current prompt in Neovim, using a Herdr popup when available)
- `yazi.ts` (`/yazi` opens Yazi and follows the selected directory like the shell `y` wrapper)
- `amplitude/` — opt-in official Amplitude MCP tools and skills
- `revenuecat/` — opt-in official RevenueCat MCP tools and AI Toolkit skills

The install configurations link each file into Pi's global extension directory instead of replacing the whole directory, so machine-local extensions with other names can coexist with the managed files. Existing files with the managed names are replaced during installation.

| Installer | Target |
| --- | --- |
| `./install` | `~/.pi/agent/extensions/` |
| `.\install.ps1` | `~/.pi/agent/extensions/` |
| `./install.msys2` | `D:/.pi/agent/extensions/` |

The installer runs `npm install` in Pi's extension directory for extension runtime dependencies. After installation, restart Pi or run `/reload` in an active Pi session.

## Neovim prompt editor

`Ctrl+G` uses `agent/extensions/neovim.lua` via `nvim -u` in both the current
terminal and a Herdr popup. It requires the dotfiles Neovim 0.12+ configuration
and reuses its native options, autocmds, platform settings, and editing keymaps.
Normal `nvim` startup is unchanged.

The prompt profile bypasses Lazy, LSP/Mason, Git, and Markdown rendering. It uses
native Markdown syntax and loads only already-installed Catppuccin, surround,
autopairs (without Treesitter), and better-escape (`jk`/`jj`). Catppuccin uses a
separate cache with automatic integrations disabled. Missing plugins are skipped;
a missing theme falls back to `habamax`. No plugins or tools are installed.
Plugin-manager, Mason, Snacks, and render-markdown keymaps are omitted in this profile.

Reload Pi with `/reload` after updating. The existing Windows terminal handoff
delay and Herdr popup lifecycle are unchanged.

Regression checks (Node 22.18+; Neovim checks skip if the executable is absent):

```bash
node --test pi/agent/extensions/tests/neovim.test.cjs
```

## Third-party packages

Do not commit `~/.pi/agent/settings.json` or `~/.pi/agent/npm/`. Those are machine-local.

Do not edit [`agent/packages`](agent/packages) by hand.

```bash
pi install npm:@scope/pkg   # this machine
pi remove npm:@scope/pkg
git commit                  # pre-commit copies settings.packages into agent/packages
```

`./install` on another machine reads that file and runs `pi install` for each line. `pi` must already be on PATH.

## Fabric agents and Goal

The package list uses `pi-fabric` instead of `pi-subagents`. Use Fabric's
`agents.run()` / `agents.spawn()` and workflow helpers for child tasks; old
`subagent` / `runs.run()` workflows are not interchangeable with these APIs.
The old worker's strict native-tool allowlist conflicts with Fabric full code
mode and can leave the child with no active tools.

For full code mode alongside `pi-goal`, merge these entries into
`~/.pi/agent/fabric.json` (preserve any existing `capture.keepVisible` entries):

```json
{
  "fullCodeMode": true,
  "capture": {
    "keepVisible": ["fabric_exec", "goal_complete", "goal_blocked", "goal_wait"]
  }
}
```

Goal requires `goal_complete` and `goal_blocked` in Pi's active tool list;
registered-but-hidden tools do not satisfy its check. Keep all three Goal tools
on the native path, and call `goal_wait` alone. This addresses tool visibility,
not an end-to-end compatibility guarantee for continuation, cancellation, or
compaction. Fabric's compaction engine is independent of full code mode; set
`compaction.engine` to `"pi"` if you want to retain Pi's existing engine.

`herdr-agent-name.ts` skips both `PI_SUBAGENT_CHILD=1` and non-empty
`PI_FABRIC_PARENT_RUN` children, including Fabric actors, so they do not rename
inherited parent panes.

## Agency MCP (automatic)

Start Pi normally:

```bash
pi
```

At session startup, the extension checks `agency --version` with a five-second
timeout. If the CLI is available on PATH and runs successfully, it connects to
Agency's MCP Gateway automatically; no startup flag is needed. If the CLI is
missing, fails the check, or times out, it silently skips MCP startup without
registering Agency tools or injecting its system-prompt guidance. Gateway
connection errors after a successful check are still reported.

Use `/agency-status` to inspect availability/connection state. After installing
Agency or changing PATH, restart Pi (or `/reload` if this process already has the
updated PATH).

The extension exposes the Gateway's tools under the `agency_` prefix. It loads
only the Gateway initially; use `agency_search_tools` and `agency_load_toolset`
to discover and load any Agency MCP toolset without starting every server.

### Finish PR long waits

`agency_call_tool` calls targeting the default `finish-pr` toolset's
`finish_pull_request` tool go directly to `agency mcp finish-pr` over stdio.
Discovery/schema lookup still uses Gateway; other tool calls are unchanged.
This avoids Gateway's 180-second backend timeout. The dedicated MCP receives
Pi's current working directory and is closed on completion, cancellation, error,
or session shutdown/reload. A 120-second silence timeout is refreshed by Agency's
30-second progress notifications; `max_wait_seconds` remains server-controlled
(default 1800). A terminal MCP error remains an error, not a successful result.

On Windows, the dedicated client also sends serial MCP `ping` requests once per
second. These unblock Agency's Git startup when inheriting stdin races with the
MCP reader. Pings never become progress updates or reset the tool's silence timer;
only Agency's real progress notifications do that. Ping failures fail the call,
and completion/cancellation/shutdown stops the timer. No Agency source patch or
local Rust build is required.

Use `/skill:finish-pr <PR URL or id>` after installing the skills. The existing
Dotbot skill glob includes `agent/skills/finish-pr`. To try it without installing:

```bash
pi --skill ./pi/agent/skills/finish-pr/SKILL.md
```

For Fabric full-code mode, merge this into `~/.pi/agent/fabric.json`, preserving
other executor settings and existing `hostCallTimeouts` entries:

```json
{
  "executor": {
    "maxTimeoutMs": 2100000,
    "hostCallTimeouts": {
      "extensions.agency_call_tool": 2100000
    }
  }
}
```

This gives captured Agency calls a 35-minute whole-program deadline (the default
Fabric ceiling is only 15 minutes); other calls retain their normal default.
Run one wait per Fabric program. Longer PR waits require a matching executor
ceiling and per-invocation `timeoutMs`. Reload/restart Pi after configuration changes.
The watcher can requeue policies and conditionally rebase/push: use `dry_run: true`
for read-only monitoring, and do not run parallel model polling alongside it.

Regression check (real MCP SDK, simulated clock; no PR access):

```bash
node --test pi/agent/extensions/tests/agency-finish-pr.test.cjs
```

Set `PI_FINISH_PR_STDIO_PROBE=1` when running that test to also exercise a real
stdio child for 185 seconds and verify process cleanup on completion/cancel.
The child is a local fixture, not Agency; neither test mode touches a PR.

## Amplitude (opt-in)

Amplitude is disabled by default. Enable its MCP connection and the official skills from
[`amplitude/mcp-marketplace`](https://github.com/amplitude/mcp-marketplace) for one Pi process:

```bash
pi --amplititude
```

The spelling above is retained for compatibility with the original flag request;
`pi --amplitude` is also accepted. On first use, `mcp-remote` opens the browser for
Amplitude OAuth. Authentication is cached by `mcp-remote`. The endpoint can be overridden
with `PI_AMPLITUDE_MCP_URL`.

## RevenueCat (opt-in)

RevenueCat is disabled by default. Enable its hosted MCP tools and the main plugin skills from
[`RevenueCat/ai-toolkit`](https://github.com/RevenueCat/ai-toolkit) for one Pi process:

```bash
pi --revenuecat
```

On first use, `mcp-remote` opens the browser for RevenueCat OAuth. Authentication is cached by
`mcp-remote`. Override the hosted endpoint with `PI_REVENUECAT_MCP_URL` when needed. The
specialized `revenuecat-play-billing` skill pack is not loaded by this flag.

The MCP extensions use upstream Git submodules and the shared Pi extension npm dependencies.
The Dotbot installers initialize the submodules and install dependencies automatically.
For manual setup:

```bash
git submodule update --init --recursive
npm install --prefix pi/agent/extensions
```

Do not commit Pi runtime data or credentials such as `~/.pi/agent/auth.json`, sessions, history, or trust settings.
