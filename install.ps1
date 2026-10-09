# Shared Windows installer. Prefer install.personal.ps1 or install.work.ps1.
param(
    [ValidateSet('personal', 'work')][string]$Profile = 'personal',
    [switch]$AgentsOnly,
    [string]$TunnelId,
    [string]$McpUrl,
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

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
}

$PreviousProfile = $env:DOTFILES_PROFILE
$env:DOTFILES_PROFILE = $Profile
Push-Location $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Install-WingetPackage 'OpenJS.NodeJS.LTS'
        Refresh-Path
    }
    $NodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or [version]$NodeVersion.TrimStart('v') -lt [version]'22.0') {
        throw 'Node.js 22+ is required; upgrade Node and retry.'
    }

    if ($Profile -eq 'work' -and ($TunnelId -or $McpUrl -or -not (Test-Path -LiteralPath "$HOME/.hindsight/client.json"))) {
        if (-not $TunnelId -or -not $McpUrl) {
            Write-Host 'First-time Hindsight setup: read tunnelId and url from ~/.hindsight/client.json on your existing host.'
            Write-Host 'These values are saved only on this computer. No new server or tunnel will be created.'
            try {
                if (-not $TunnelId) { $TunnelId = ([string](Read-Host 'Tunnel ID (including cluster, e.g. name.asse)')).Trim() }
                if (-not $McpUrl) { $McpUrl = ([string](Read-Host 'Full HTTPS MCP URL (ending in /mcp/<bank>/)')).Trim() }
            } catch {
                throw 'Cannot read setup input. Rerun install.work.ps1 with both -TunnelId and -McpUrl.'
            }
            if ([string]::IsNullOrWhiteSpace($TunnelId) -or [string]::IsNullOrWhiteSpace($McpUrl)) {
                throw 'Hindsight connection cannot be empty. Supply both -TunnelId and -McpUrl, or enter them at the prompts.'
            }
        }
    }
    $Configure = Join-Path $PSScriptRoot 'scripts/configure-agents.mjs'
    $ProfileArgs = @('--profile', $Profile)
    if ($TunnelId) { $ProfileArgs += @('--tunnel-id', $TunnelId) }
    if ($McpUrl) { $ProfileArgs += @('--url', $McpUrl) }
    & node $Configure @ProfileArgs --check
    if ($LASTEXITCODE -ne 0) { throw 'Profile preflight failed; agent configuration was not changed.' }

    if (-not $AgentsOnly) {
        foreach ($Package in @(
            'Gyan.FFmpeg', '7zip.7zip', 'jqlang.jq', 'oschwartz10612.Poppler',
            'sharkdp.bat', 'sharkdp.fd', 'BurntSushi.ripgrep.MSVC', 'junegunn.fzf',
            'ajeetdsouza.zoxide', 'ImageMagick.ImageMagick', 'sxyazi.yazi',
            'JesseDuffield.lazygit', 'Neovim.Neovim', 'Nushell.Nushell',
            'eza-community.eza', 'max-sixty.worktrunk'
        )) { Install-WingetPackage $Package }
        Refresh-Path

        git submodule update --init --recursive
        if ($LASTEXITCODE -ne 0) { throw 'Git submodule installation failed.' }
    } else {
        git submodule update --init --recursive dotbot
        if ($LASTEXITCODE -ne 0) { throw 'Dotbot submodule installation failed.' }
    }
    $Python = $null
    foreach ($Candidate in @('python', 'python3')) {
        if (Get-Command $Candidate -ErrorAction SilentlyContinue) {
            & $Candidate -V
            if ($LASTEXITCODE -eq 0) { $Python = $Candidate; break }
        }
    }
    if (-not $Python) { throw 'Cannot find Python for Dotbot.' }
    if (-not $AgentsOnly) {
        & $Python "$PSScriptRoot/dotbot/bin/dotbot" -d $PSScriptRoot -c "$PSScriptRoot/install.conf-win.yaml" @DotbotArgs
        if ($LASTEXITCODE -ne 0) { throw 'Dotbot installation failed.' }
    }

    if ($Profile -eq 'work') {
        if (-not (Get-Command devtunnel -ErrorAction SilentlyContinue)) {
            Install-WingetPackage 'Microsoft.devtunnel'
            Refresh-Path
        }
        # npm.ps1 re-evaluates the invocation and can lose caller variables; use the native shim.
        & npm.cmd ci --prefix "$PSScriptRoot/hindsight"
        if ($LASTEXITCODE -ne 0) { throw 'Hindsight MCP dependency installation failed.' }
    }
    & $Python "$PSScriptRoot/dotbot/bin/dotbot" -d $PSScriptRoot -c "$PSScriptRoot/install.conf-agents.yaml" @DotbotArgs
    if ($LASTEXITCODE -ne 0) { throw 'Agent guidance symlinks failed. Enable Windows Developer Mode or run with symlink privileges.' }
    & node $Configure @ProfileArgs
    if ($LASTEXITCODE -ne 0) { throw 'Agent profile configuration failed.' }
    if ($Profile -eq 'work') {
        # The host/database already exists. Verify the private tunnel without writing memories.
        & node "$PSScriptRoot/hindsight/smoke.mjs"
        if ($LASTEXITCODE -ne 0) { throw 'MCP configured but not connected. Check the host, run devtunnel user login as the tunnel owner, then rerun.' }
    }
    Write-Host "Installed $Profile profile. Restart Claude Code, Cursor and Copilot; /reload Pi."
} finally {
    $env:DOTFILES_PROFILE = $PreviousProfile
    Pop-Location
}
