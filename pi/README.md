# Pi configuration

This directory contains the Pi extensions managed by Dotbot.

## Managed extensions

- `agency-hub.ts`
- `claude-statusline.ts`
- `copilot-web-search.ts`
- `lazygit.ts` (`/lazygit` temporarily opens lazygit in the current directory, then returns to the same Pi session)

The install configurations link each file into Pi's global extension directory instead of replacing the whole directory, so machine-local extensions with other names can coexist with the managed files. Existing files with the managed names are replaced during installation.

| Installer | Target |
| --- | --- |
| `./install` | `~/.pi/agent/extensions/` |
| `.\install.ps1` | `~/.pi/agent/extensions/` |
| `./install.msys2` | `D:/.pi/agent/extensions/` |

After installation, restart Pi or run `/reload` in an active Pi session.

Do not commit Pi runtime data or credentials such as `~/.pi/agent/auth.json`, sessions, history, or trust settings.
