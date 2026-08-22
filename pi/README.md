# Pi configuration

This directory contains the Pi extensions managed by Dotbot.

## Managed extensions

- `agency-hub.ts`
- `claude-statusline.ts`
- `copilot-web-search.ts` (`web_search` via Copilot plus a direct, SSRF-guarded, token-efficient `web_fetch`)
- `herdr-agent-name.ts` (inside Herdr, uses `github-copilot/gpt-5.6-luna` to derive a unique live-agent name from the session's first prompt)
- `lazygit.ts` (`/lazygit` temporarily opens lazygit in the current directory, then returns to the same Pi session)
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

## Third-party packages

Do not commit `~/.pi/agent/settings.json` or `~/.pi/agent/npm/`. Those are machine-local.

Do not edit [`agent/packages`](agent/packages) by hand.

```bash
pi install npm:@scope/pkg   # this machine
pi remove npm:@scope/pkg
git commit                  # pre-commit copies settings.packages into agent/packages
```

`./install` on another machine reads that file and runs `pi install` for each line. `pi` must already be on PATH.

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
