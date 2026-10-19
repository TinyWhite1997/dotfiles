# Worktrunk (Windows) for Herdr

A native-Windows replacement for `devashish2203/herdr-worktrunk`, whose manifest only supports macOS and Linux.

It opens a temporary floating `fzf` picker, lets Worktrunk switch or create the checkout, then registers that checkout as a native Herdr worktree workspace. Worktrunk hooks still run. It uses `git-wt.exe` first, avoiding Windows Terminal's `wt` name collision.

Requirements: Herdr preview with Windows plugin support, Node.js, Worktrunk ≥ 0.60, and `fzf` for the remove picker.

The Nushell `herdr switch [-c] <branch>` command and popup share `scripts/open.cjs`. If a running Herdr server cannot find Git (`worktree_list_failed: program not found`), it opens a regular workspace at the checkout resolved by Worktrunk, or focuses an existing pane there. Native worktree grouping remains unavailable until Git is restored to the server's PATH; other errors are not bypassed.

```powershell
herdr plugin link C:\path\to\dotfiles\herdr\plugins\worktrunk-windows
```

Bind `worktrunk.windows.open`, `worktrunk.windows.open-current`, and `worktrunk.windows.remove` to your preferred Herdr keys.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\runner.test.ps1
node --test .\tests\open.test.cjs
```
