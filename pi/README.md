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
| `.\install.personal.ps1` / `.\install.work.ps1` | `~/.pi/agent/extensions/` |
| `./install.msys2` | `D:/.pi/agent/extensions/` |

The installer runs `npm install` in Pi's extension directory for extension runtime dependencies. After installation, restart Pi or run `/reload` in an active Pi session.

## Work / personal guidance and Hindsight

Windows has two explicit [profile installers](../INSTALL.md). Dotbot symlinks
`instructions/work.md` or `instructions/personal.md` as user guidance for
Pi and Copilot; source edits need no reinstall, only a client reload. Work also registers the private Hindsight stdio MCP in Pi,
Copilot, Claude Code and Cursor; Personal removes only this adapter's MCP entry.
`~/.pi/agent/mcp.json` and the optional `~/.hindsight/client.json` override remain
machine-local, never linked from Git. New work machines read the shared
`hindsight/client.work.json` default without entering a tunnel ID or URL. Use `-AgentsOnly` to switch without reinstalling
common dotfiles. Other platforms default to personal guidance;
`DOTFILES_PROFILE=work ./install` selects work guidance without registering MCPs.

## Neovim prompt editor

`Ctrl+G` uses `agent/extensions/neovim.lua` via `nvim -u` in both the current
terminal and a Herdr popup. It requires the dotfiles Neovim 0.12+ configuration
and reuses its native options, autocmds, platform settings, and editing keymaps.
Normal `nvim` startup is unchanged.

The prompt profile bypasses Lazy, LSP/Mason, Git, and Markdown rendering. It uses
native Markdown syntax and loads only already-installed Catppuccin, surround,
and autopairs (without Treesitter). Insert-mode `jk`/`jj` use native Escape mappings,
so they also work without plugins. The leader is Space: `<leader>w` saves and
`<leader>q` quits the window, confirming unsaved changes. Catppuccin uses a
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

## Goal-X

The default package is `pi-goal-x@0.32.3`, pinned to the version checked with
Pi `1.0.0` and Fabric `0.104.1`. `/goal <idea>` discusses a plan before confirmation;
`/goal-direct <objective>` starts immediately. `/sisyphus` plans ordered work.
Use `/goal-list` and `/goal-focus` to switch between open goals, and
`/goal-pause` / `/goal-resume` to stop or continue the focused goal.

[`agent/pi-goal-x-settings.json`](agent/pi-goal-x-settings.json) sets:

- `maxAutonomousRuns: 100`: allow 100 extension-started runs per creation/resume.
  One run can contain multiple model responses/tool loops, so this is not the
  old package's response-count unit or a dollar cap. Adjust it in `/goal-settings`.
- `autoSelectSingleGoal: false`: a fresh session does not automatically focus
  the project's only open goal. Select and explicitly resume it yourself.
- `auditorProjectResources: false`: the independent auditor uses its isolated
  SDK session, not the parent's extensions or Fabric tool restrictions.

Auditing remains enabled by default and uses the current model unless changed
in `/goal-settings`. It adds model calls. Its tools include `bash`, so isolation
from extensions is **not** a read-only OS sandbox or inherited Fabric approval policy.
All installers link the settings into Pi's agent directory. Goal files, evidence,
ledgers and archives live in `.pi/goals/`; keep that directory out of Git.
Old goals are not migrated from the other package's session format.

The old Goal configuration is no longer managed or retained. Existing machines
must remove `npm:@narumitw/pi-goal` before using Goal-X: both register `/goal`,
and installers install listed packages without pruning unlisted ones.
Restart Pi after migration rather than reloading an in-flight goal.

## Fabric agents and Goal-X

The package list uses `pi-fabric` instead of `pi-subagents`. Use Fabric's
`agents.run()` / `agents.spawn()` and workflow helpers for child tasks; old
`subagent` / `runs.run()` workflows are not interchangeable with these APIs.

Goal-X tools work through Fabric capture in full code mode. Discover schemas
with `tools.list` / `tools.describe`, then call `extensions.get_goal`,
`extensions.create_goal`, `extensions.update_goal`, `extensions.set_goal_tasks`,
`extensions.update_goal_task`, or the three drafting tools (`goal_question`,
`goal_questionnaire`, `propose_goal_draft`) as appropriate. Call lifecycle,
confirmation and wait operations alone in a Fabric program, and inspect their
results; do not batch work after a terminating operation.

There is no `goal_complete` or `goal_wait` in Goal-X. Completion uses
`update_goal({status: "complete"})`. New external-wait declarations require
Goal-X's opt-in `strictExecutionContract`; leave it off for ordinary auto-continuation.
Do not copy old Goal tool names into Fabric. In Fabric `0.104.1`, `capture.keepVisible`
is a legacy preference, not an escape from full-code declarations. No foreground
tool exceptions are needed for the tested captured execution path.

Merge this into the machine-local `~/.pi/agent/fabric.json`, preserving other
executor settings and timeout entries (including Agency's timeout):

```json
{
  "fullCodeMode": true,
  "executor": {
    "maxTimeoutMs": 86400000,
    "hostCallTimeouts": {
      "extensions.update_goal": 86400000
    }
  }
}
```

A call to `extensions.update_goal` raises its enclosing Fabric program's deadline
to **24 hours**, Fabric's supported maximum. This is a cancellation timeout for
that whole invocation, not a target review duration or a separate timer per
review step. The shared `maxTimeoutMs` must also be 24 hours or it would clamp
the audit allowance. Ordinary calls retain their default deadlines; Agency
retains its 35-minute allowance. Manual cancellation and provider/tool-specific
limits still apply, and a long audit can consume paid model calls.

Fabric's compaction engine is unchanged; Goal-X saves state to disk and observes
Pi's compaction events.

The offline smoke probe loads the real installed extensions with a scripted
provider: exclusive Fabric declarations, captured reads, automatic continuation,
isolated audit reads using the parent's provider, rejection without archival,
and approval with termination/archival. It makes no paid model calls:

```bash
node pi/goal-x-fabric-smoke.mjs <pi-package-dir> <fabric-package-dir> <goal-x-package-dir>
```

This is not a full compatibility guarantee: interactive dialogs, Escape during
an audit, automatic compaction under context pressure, and resumed/forked Fabric
workers are not covered. Goal-X's delegated-session guard recognizes
`PI_SUBAGENT_CHILD`/`PI_SUBAGENT_DEPTH`, not Fabric's markers. Keep goal ownership
in the parent; do not resume its goal in workers or enable automatic single-goal
selection. Use fresh task-scoped children rather than forks inheriting an active
goal transcript until that path is verified.

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
    "maxTimeoutMs": 86400000,
    "hostCallTimeouts": {
      "extensions.agency_call_tool": 2100000
    }
  }
}
```

This gives captured Agency calls a 35-minute whole-program deadline (the default
Fabric ceiling is only 15 minutes). The shared ceiling stays at 24 hours for
Goal-X auditing; unrelated calls retain their own configured/default deadlines.
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
