$ErrorActionPreference = 'Stop'

# Herdr emits UTF-8 JSON; Windows PowerShell otherwise decodes it using the console code page.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

if (-not (Get-Command herdr -ErrorAction SilentlyContinue)) {
    Write-Host 'Skipping Herdr setup: herdr is not on PATH.'
    exit 0
}

$Repo = Split-Path $PSScriptRoot -Parent
$PluginList = herdr plugin list --json
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$Plugins = ($PluginList | ConvertFrom-Json).result.plugins.plugin_id

foreach ($Plugin in @(
    @{ Id = 'pi.popup'; Path = "$Repo\pi\agent\extensions\herdr-pi-popup" }
    @{ Id = 'worktrunk.windows'; Path = "$PSScriptRoot\plugins\worktrunk-windows" }
    @{ Id = 'fzf.popup'; Path = "$PSScriptRoot\plugins\fzf-popup" }
)) {
    if (-not (Test-Path (Join-Path $Plugin.Path 'herdr-plugin.toml') -PathType Leaf)) {
        Write-Host "Skipping Herdr plugin $($Plugin.Id): plugin manifest not found."
        continue
    }
    if ($Plugins -contains $Plugin.Id) {
        herdr plugin unlink $Plugin.Id
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
    }
    herdr plugin link $Plugin.Path
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}

herdr plugin install smarzban/herdr-file-viewer --yes
if ($LASTEXITCODE) { exit $LASTEXITCODE }
herdr plugin install devashish2203/herdr-worktrunk --yes
if ($LASTEXITCODE) { exit $LASTEXITCODE }
foreach ($Integration in @(
    @{ Id = 'pi'; Directory = "$HOME\.pi\agent" }
    @{ Id = 'claude'; Directory = "$HOME\.claude" }
)) {
    if (-not (Get-Command $Integration.Id -ErrorAction SilentlyContinue) -or
        -not (Test-Path $Integration.Directory -PathType Container)) {
        Write-Host "Skipping Herdr $($Integration.Id) integration: CLI or configuration directory not found."
        continue
    }
    herdr integration install $Integration.Id
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
