# fzf popup for Herdr

The Nushell adapter keeps fzf's official Ctrl+T, Ctrl+R, Alt+C and `jj` completion,
but runs fzf in an 80% Herdr popup when `HERDR_ENV=1`. Ordinary terminals and
nested popup commands use the normal binary. Themes and previews are unchanged.

`herdr/setup.ps1` links this plugin. `install.conf-win.yaml` generates the official
Nushell script at `$nu.default-config-dir/fzf.nu`; `config/nushell/fzf-herdr.nu`
loads it after defining the launcher. Restart Nushell after installation.
Requires Node.js and fzf on PATH (both already used by these dotfiles).

Each invocation has a private temporary directory for raw stdin, argv/environment,
output. A private local pipe returns the exit status and detects forced window
closure without polling (Herdr popup creation returns no pane ID). Only the
foreground caller may open a session-modal popup. History stays NUL-delimited, selected paths are
still quoted by upstream, and cd/editor changes happen in the original shell.
Esc/Ctrl+C, no match and forced popup closure return no selection. Temporary files
and the popup are cleaned up; a 30-minute safety timeout prevents indefinite waits.

Checks (no live Herdr windows are opened by these tests):

```sh
node --test herdr/plugins/fzf-popup/fzf.test.cjs
nu -n config/nushell/test-fzf.nu
```
