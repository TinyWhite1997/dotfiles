# Shared Windows installer. Prefer install.personal.ps1 or install.work.ps1.
param(
    [ValidateSet('personal', 'work')][string]$Profile = 'personal',
    [switch]$AgentsOnly,
    [string[]]$DotbotArgs = @()
)
$ErrorActionPreference = 'Stop'

function Install-WingetPackage([string]$Id) {
    if (winget list --id $Id --exact --source winget --accept-source-agreements | Select-String -Pattern $Id -SimpleMatch -Quiet) {
        # Native Nushell integration needs 0.74.4+ for safe Ctrl+T path quoting.
        if ($Id -eq 'junegunn.fzf' -and [version]((& fzf --version).Split(' ')[0]) -lt [version]'0.74.4') {
            winget upgrade --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
            if ($LASTEXITCODE -ne 0) { throw 'Failed to upgrade fzf for Nushell integration.' }
        }
        return
    }
    winget install --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "Failed to install $Id." }
}

function Get-DotbotPython {
    # Store Python redirects AppData writes into its private cache, hiding Dotbot links from apps.
    foreach ($Command in (Get-Command python, python3 -All -CommandType Application -ErrorAction SilentlyContinue)) {
        if ($Command.Source -like '*\Microsoft\WindowsApps\*') { continue }
        & $Command.Source -V | Out-Host
        if ($LASTEXITCODE -eq 0) { return $Command.Source }
    }
}

function Refresh-Path {
    # CMD drops PATH when repeated refreshes grow it beyond its environment limit.
    $Seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $Paths = @([Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) -join ';'
    $env:Path = (($Paths -split ';') | Where-Object { $_ -and $Seen.Add($_.TrimEnd('\')) }) -join ';'
}

function Repair-AgentJunctions([string]$Repo, [string]$Python, [string]$AgentHome = "$HOME/.pi/agent") {
    foreach ($Kind in @('skills', 'extensions')) {
        foreach ($Source in (Get-ChildItem -LiteralPath "$Repo/pi/agent/$Kind" -Directory)) {
            $Link = Get-Item -LiteralPath "$AgentHome/$Kind/$($Source.Name)" -Force -ErrorAction SilentlyContinue
            if ($Link.LinkType -ne 'Junction' -or $Link.Target -ne $Source.FullName) { continue }
            # Dotbot mistakes junctions for real directories; remove only our junction, never its target.
            [IO.Directory]::Delete($Link.FullName)
            & $Python -c "import os, sys; os.symlink(sys.argv[1], sys.argv[2], target_is_directory=True)" $Source.FullName $Link.FullName
            if ($LASTEXITCODE -ne 0) { throw "Cannot replace legacy junction $($Link.FullName) with a symlink." }
            Write-Host "Replaced legacy junction $($Link.FullName) with a symlink."

        }
    }
}

$PreviousProfile = $env:DOTFILES_PROFILE
$env:DOTFILES_PROFILE = $Profile
Push-Location $PSScriptRoot
try {
    Refresh-Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Install-WingetPackage 'OpenJS.NodeJS.LTS'
        Refresh-Path
    }
    $NodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or [version]$NodeVersion.TrimStart('v') -lt [version]'22.0') {
        throw 'Node.js 22+ is required; upgrade Node and retry.'
    }

    # Keep the config writer to remove our existing MCP registrations safely.
    & npm.cmd ci --prefix "$PSScriptRoot/scripts"
    if ($LASTEXITCODE -ne 0) { throw 'Agent configuration dependency installation failed.' }

    $Configure = Join-Path $PSScriptRoot 'scripts/configure-agents.mjs'
    # Hindsight is paused for both guidance profiles; reuse the existing Personal cleanup path.
    $CleanupArgs = @('--profile', 'personal')
    & node $Configure @CleanupArgs --check
    if ($LASTEXITCODE -ne 0) { throw 'Profile preflight failed; agent configuration was not changed.' }

    if (-not $AgentsOnly) {
        foreach ($Package in @(
            'Gyan.FFmpeg', '7zip.7zip', 'jqlang.jq', 'oschwartz10612.Poppler',
            'sharkdp.bat', 'sharkdp.fd', 'BurntSushi.ripgrep.MSVC', 'junegunn.fzf',
            'ajeetdsouza.zoxide', 'ImageMagick.ImageMagick', 'sxyazi.yazi',
            'JesseDuffield.lazygit', 'Neovim.Neovim', 'Nushell.Nushell',
            'eza-community.eza', 'max-sixty.worktrunk', 'AutoHotkey.AutoHotkey',
            'DEVCOM.JetBrainsMonoNerdFont'
        )) { Install-WingetPackage $Package }
        Refresh-Path

        git submodule update --init --recursive
        if ($LASTEXITCODE -ne 0) { throw 'Git submodule installation failed.' }
    } else {
        git submodule update --init --recursive dotbot
        if ($LASTEXITCODE -ne 0) { throw 'Dotbot submodule installation failed.' }
    }
    $Python = Get-DotbotPython
    if (-not $Python) {
        Install-WingetPackage 'Python.Python.3.13'
        Refresh-Path
        $Python = Get-DotbotPython
    }
    if (-not $Python) { throw 'Cannot find non-Store Python for Dotbot. Restart the terminal and retry.' }
    & $Python -c "import os, sys, tempfile; d = tempfile.TemporaryDirectory(); os.symlink(sys.executable, os.path.join(d.name, 'link')); d.cleanup()"
    if ($LASTEXITCODE -ne 0) { throw 'Dotbot needs symlink privileges. Enable Windows Developer Mode or rerun this installer as administrator.' }
    if (-not $AgentsOnly) {
        if ($DotbotArgs -notcontains '--dry-run' -and $DotbotArgs -notcontains '-n') {
            Repair-AgentJunctions -Repo $PSScriptRoot -Python $Python
        }
        & $Python "$PSScriptRoot/dotbot/bin/dotbot" -d $PSScriptRoot -c "$PSScriptRoot/install.conf-win.yaml" @DotbotArgs
        if ($LASTEXITCODE -ne 0) { throw 'Dotbot installation failed.' }
    }

    & $Python "$PSScriptRoot/dotbot/bin/dotbot" -d $PSScriptRoot -c "$PSScriptRoot/install.conf-agents.yaml" @DotbotArgs
    if ($LASTEXITCODE -ne 0) { throw 'Agent guidance symlinks failed. Enable Windows Developer Mode or run with symlink privileges.' }
    & node $Configure @CleanupArgs
    if ($LASTEXITCODE -ne 0) { throw 'Agent profile configuration failed.' }
    Write-Host "Installed $Profile profile. Restart Claude Code, Codex and Copilot; /reload Pi."
} finally {
    $env:DOTFILES_PROFILE = $PreviousProfile
    Pop-Location
}
