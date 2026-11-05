# Worktrunk (Windows) for Herdr

A native-Windows replacement for `devashish2203/herdr-worktrunk`, whose manifest only supports macOS and Linux.

It opens a temporary floating `fzf` picker, lets Worktrunk switch or create the checkout, then registers that checkout as a native Herdr worktree workspace. Worktrunk hooks still run. It uses `git-wt.exe` first, avoiding Windows Terminal's `wt` name collision.

Requirements: Herdr preview with Windows plugin support, Node.js, Worktrunk ≥ 0.60, and `fzf` for the remove picker.

The Nushell `herdr switch [-c] <branch>` command and popup share `scripts/open.cjs`. Worktrunk runs this helper in the target checkout, even with `--no-cd`; the helper resolves the primary checkout from Git's NUL-delimited worktree list and always uses that as Herdr's source. This also supports switching from a linked worktree or its subdirectories, without relying on the focused workspace or a caller workspace ID. On Windows it prefers Git for Windows's standard installation, so a stale pane PATH does not prevent local checkout discovery.

If a running Herdr server cannot find Git (`worktree_list_failed: program not found`), the helper warns and opens a regular workspace at the resolved checkout, or focuses an existing pane there. Native worktree grouping remains unavailable until Git is restored to the server's PATH; other errors are not bypassed.

```powershell
herdr plugin link C:\path\to\dotfiles\herdr\plugins\worktrunk-windows
```

Bind `worktrunk.windows.open`, `worktrunk.windows.open-current`, and `worktrunk.windows.remove` to your preferred Herdr keys.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\runner.test.ps1
node --test .\tests\*.test.cjs
```
