# Worktrunk (Windows) for Herdr

A native-Windows replacement for `devashish2203/herdr-worktrunk`, whose manifest only supports macOS and Linux.

It opens a temporary `fzf` picker, lets Worktrunk switch or create the checkout, then registers that checkout as a native Herdr worktree workspace. Worktrunk hooks still run. It uses `git-wt.exe` first, avoiding Windows Terminal's `wt` name collision.

Requirements: Herdr preview with Windows plugin support, Worktrunk ≥ 0.60, and `fzf` for the remove picker.

```powershell
herdr plugin link C:\path\to\dotfiles\herdr\plugins\worktrunk-windows
```

Bind `worktrunk.windows.open`, `worktrunk.windows.open-current`, and `worktrunk.windows.remove` to your preferred Herdr keys.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\runner.test.ps1
```
