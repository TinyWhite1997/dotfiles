$ErrorActionPreference = 'Stop'

$Repo = Split-Path $PSScriptRoot -Parent
$Plugins = (herdr plugin list --json | ConvertFrom-Json).result.plugins.plugin_id

foreach ($Plugin in @(
    @{ Id = 'pi.popup'; Path = "$Repo\pi\agent\extensions\herdr-pi-popup" }
    @{ Id = 'worktrunk.windows'; Path = "$PSScriptRoot\plugins\worktrunk-windows" }
)) {
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
herdr integration install pi
if ($LASTEXITCODE) { exit $LASTEXITCODE }
herdr integration install claude
if ($LASTEXITCODE) { exit $LASTEXITCODE }
