# No Pester/dependencies: run with pwsh -NoProfile -File scripts/install.test.ps1.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$global:InstallerTestCalls = [System.Collections.Generic.List[object]]::new()
$global:InstallerTestFail = ''
function Record([string]$Name, [object[]]$Arguments) {
    $global:InstallerTestCalls.Add(@{ Name = $Name; Arguments = @($Arguments); Profile = $env:DOTFILES_PROFILE })
    $global:LASTEXITCODE = 0
}
function Read-Host { throw 'Install must not prompt for Hindsight connection values.' }
function Get-Command {
    param([string[]]$Name, [switch]$All, [string]$CommandType, [string]$ErrorAction)
    if ($Name -contains 'python') { [pscustomobject]@{ Source = 'python' }; return }
    Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
# Real filesystem migration is covered by install-windows.test.ps1.
function Get-ChildItem { Record 'junction-scan' @() }

function node {
    Record 'node' $args
    if ($args[0] -eq '--version') { 'v24.0.0'; return }
    if ($args[0] -like '*smoke.mjs') { throw 'Paused Hindsight must not run a network smoke check.' }
    if (($global:InstallerTestFail -eq 'preflight' -and $args -contains '--check') -or
        ($global:InstallerTestFail -eq 'config' -and $args -notcontains '--check')) { $global:LASTEXITCODE = 1 }
}
function npm.cmd {
    Record 'npm' $args
    if ($args[2] -like '*/hindsight') { throw 'Paused Hindsight must not install runtime dependencies.' }
    if ($global:InstallerTestFail -eq 'config-deps' -and $args[2] -like '*/scripts') { $global:LASTEXITCODE = 1 }
}
function devtunnel { throw 'Paused Hindsight must not invoke devtunnel.' }
function winget { Record 'winget' $args; if ($args[0] -eq 'list') { $args[2] } }
function fzf { Record 'fzf' $args; '0.74.4' }
function git { Record 'git' $args; if ($global:InstallerTestFail -eq 'git') { $global:LASTEXITCODE = 1 } }
function python { Record 'python' $args; if ($args[0] -eq '-V') { 'Python 3.13.0' } elseif ($global:InstallerTestFail -eq 'dotbot' -and $args[0] -like '*dotbot/bin/dotbot') { $global:LASTEXITCODE = 1 } }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reset {
    $global:InstallerTestCalls.Clear()
    $global:InstallerTestFail = ''
}

$Original = (Get-Location).Path
$env:DOTFILES_PROFILE = 'test-previous-value'
& "$Repo/install.personal.ps1" -AgentsOnly
$Guidance = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-agents.yaml" })
Assert ($Guidance.Count -eq 1 -and $Guidance[0].Profile -eq 'personal') 'Personal AgentsOnly must link the personal guide via Dotbot.'
Assert (@($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-win.yaml" }).Count -eq 0) 'AgentsOnly must skip common Dotbot configuration.'
Assert ($env:DOTFILES_PROFILE -eq 'test-previous-value') 'Profile environment was not restored.'
Assert ($global:InstallerTestCalls[1].Name -eq 'npm' -and $global:InstallerTestCalls[1].Arguments[2] -eq "$Repo/scripts") 'Config dependencies must be installed before preflight, including Personal.'
Assert (($global:InstallerTestCalls[2].Arguments -contains 'personal') -and ($global:InstallerTestCalls[2].Arguments -contains '--check')) 'Personal wrapper lost its profile.'
Assert ((Get-Location).Path -eq $Original) 'Working directory was not restored.'

Reset
& "$Repo/install.work.ps1" -AgentsOnly
$Npm = @($global:InstallerTestCalls | Where-Object Name -eq npm)
Assert ($Npm.Count -eq 1 -and $Npm[0].Arguments[2] -eq "$Repo/scripts") 'Work must install only cleanup writer dependencies.'
$Config = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'node' -and $_.Arguments[0] -like '*configure-agents.mjs' })
Assert ($Config.Count -eq 2 -and $Config[0].Arguments -contains '--check') 'Work must preflight before cleanup.'
foreach ($Call in $Config) { Assert ($Call.Arguments -contains 'personal') 'Paused Work must use the managed MCP cleanup path.' }
$Guidance = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-agents.yaml" })
Assert ($Guidance.Count -eq 1 -and $Guidance[0].Profile -eq 'work') 'Work must still pass its profile to Dotbot guidance.'
Assert ($global:InstallerTestCalls[-1].Arguments[0] -like '*configure-agents.mjs') 'Work must finish after cleanup, without a remote smoke check.'

Reset
& "$Repo/install.personal.ps1" -DotbotArgs @('--only', 'link')
$Dotbot = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments[0] -like '*dotbot/bin/dotbot' })
Assert ($Dotbot.Count -eq 2 -and $Dotbot[0].Arguments -contains '--only' -and $Dotbot[1].Arguments -contains '--only') 'Both Dotbot configurations must receive forwarded arguments.'
Assert (@($global:InstallerTestCalls | Where-Object Name -eq winget).Count -ge 16) 'Shared package installation was skipped.'
$Npm = @($global:InstallerTestCalls | Where-Object Name -eq npm)
Assert ($Npm.Count -eq 1 -and $Npm[0].Arguments[2] -eq "$Repo/scripts") 'Personal must install only config dependencies, not Hindsight dependencies.'

Reset
& "$Repo/install.work.ps1"
$Config = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'node' -and $_.Arguments[0] -like '*configure-agents.mjs' })
Assert ($Config.Count -eq 2 -and $Config[1].Arguments -contains 'personal') 'Full Work installation must also clean up managed Hindsight registrations.'
Assert (@($global:InstallerTestCalls | Where-Object Name -eq winget).Count -ge 16) 'Full Work must retain shared package installation.'
Assert (@($global:InstallerTestCalls | Where-Object { $_.Name -eq 'winget' -and $_.Arguments -contains 'Microsoft.devtunnel' }).Count -eq 0) 'Paused Work must not install Dev Tunnels.'
Assert ($global:InstallerTestCalls[-1].Arguments[0] -like '*configure-agents.mjs') 'Full Work must finish without a remote smoke check.'

foreach ($DryRun in @('--dry-run', '-n')) {
    Reset
    & "$Repo/install.personal.ps1" -DotbotArgs @($DryRun)
    Assert (@($global:InstallerTestCalls | Where-Object Name -eq 'junction-scan').Count -eq 0) 'Dotbot dry-run must not migrate junctions.'
}

foreach ($Failure in @('config-deps', 'preflight', 'git', 'dotbot', 'config')) {
    Reset
    $global:InstallerTestFail = $Failure
    $Threw = $false
    try { & "$Repo/install.work.ps1" } catch { $Threw = $true }
    Assert $Threw "Failure '$Failure' was ignored."
    Assert ((Get-Location).Path -eq $Original) 'Failed installation did not restore working directory.'
    Assert ($env:DOTFILES_PROFILE -eq 'test-previous-value') 'Failed installation did not restore profile environment.'
    if ($Failure -ne 'config') {
        Assert (@($global:InstallerTestCalls | Where-Object { $_.Name -eq 'node' -and $_.Arguments[0] -like '*configure-agents.mjs' -and $_.Arguments -notcontains '--check' }).Count -eq 0) 'Configuration applied after failed prerequisite.'
    }
}
Write-Host 'Installer checks passed (entrypoints, shared steps, argument forwarding, failures, directory restoration).'
