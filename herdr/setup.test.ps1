$ErrorActionPreference = 'Stop'
$Setup = Join-Path $PSScriptRoot 'setup.ps1'
$global:HerdrTestCalls = @()
$global:HerdrTestMissing = @()
function Get-Command {
    param($Name, $ErrorAction)
    if ($Name -notin $global:HerdrTestMissing) { [pscustomobject]@{ Name = $Name } }
}
function Test-Path {
    param($Path, $PathType)
    return $Path -notin $global:HerdrTestMissing
}
function herdr {
    $global:HerdrTestCalls += ($args -join ' ')
    $global:LASTEXITCODE = 0
    if (($args -join ' ') -eq 'plugin list --json') { '{"result":{"plugins":[]}}' }
}

foreach ($Case in @('all', 'claude-cli', 'claude-directory', 'pi-cli', 'pi-directory', 'manifest', 'herdr')) {
    $global:HerdrTestCalls = @()
    $global:HerdrTestMissing = switch ($Case) {
        'claude-cli' { 'claude' }
        'claude-directory' { "$HOME\.claude" }
        'pi-cli' { 'pi' }
        'pi-directory' { "$HOME\.pi\agent" }
        'manifest' { Join-Path $PSScriptRoot 'plugins\fzf-popup\herdr-plugin.toml' }
        'herdr' { 'herdr' }
    }
    & $Setup
    foreach ($Id in @('pi', 'claude')) {
        $Expected = $Case -ne 'herdr' -and $Case -notlike "$Id-*"
        if (($global:HerdrTestCalls -contains "integration install $Id") -ne $Expected) {
            throw "$Case : unexpected $Id integration execution"
        }
    }
    if ($Case -eq 'herdr' -and $global:HerdrTestCalls.Count) { throw 'Called missing herdr' }
    if ($Case -eq 'manifest' -and ($global:HerdrTestCalls -match 'plugin link .*fzf-popup')) { throw 'Linked missing manifest' }
}
Write-Host 'Herdr optional component checks passed (7 cases).'
