# No Pester/dependencies: run with pwsh -NoProfile -File scripts/install.test.ps1.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$global:InstallerTestCalls = [System.Collections.Generic.List[object]]::new()
$global:InstallerTestFail = ''
function Record([string]$Name, [object[]]$Arguments) {
    $global:InstallerTestCalls.Add(@{ Name = $Name; Arguments = @($Arguments); Profile = $env:DOTFILES_PROFILE })
    $global:LASTEXITCODE = 0
}
function node {
    Record 'node' $args
    if ($args[0] -eq '--version') { 'v24.0.0'; return }
    if (($global:InstallerTestFail -eq 'preflight' -and $args -contains '--check') -or
        ($global:InstallerTestFail -eq 'smoke' -and $args[0] -like '*smoke.mjs')) { $global:LASTEXITCODE = 1 }
}
function npm.cmd { Record 'npm' $args; if ($global:InstallerTestFail -eq 'npm') { $global:LASTEXITCODE = 1 } }
function devtunnel { Record 'devtunnel' $args }
function winget { Record 'winget' $args; if ($args[0] -eq 'list') { $args[2] } }
function fzf { Record 'fzf' $args; '0.74.4' }
function git { Record 'git' $args; if ($global:InstallerTestFail -eq 'git') { $global:LASTEXITCODE = 1 } }
function python { Record 'python' $args; if ($args[0] -eq '-V') { 'Python 3.13.0' } elseif ($global:InstallerTestFail -eq 'dotbot') { $global:LASTEXITCODE = 1 } }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reset { $global:InstallerTestCalls.Clear(); $global:InstallerTestFail = '' }

$Original = (Get-Location).Path
$env:DOTFILES_PROFILE = 'test-previous-value'
& "$Repo/install.personal.ps1" -AgentsOnly
$Guidance = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-agents.yaml" })
Assert ($Guidance.Count -eq 1 -and $Guidance[0].Profile -eq 'personal') 'Personal AgentsOnly must link the personal guide via Dotbot.'
Assert (@($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-win.yaml" }).Count -eq 0) 'AgentsOnly must skip common Dotbot configuration.'
Assert ($env:DOTFILES_PROFILE -eq 'test-previous-value') 'Profile environment was not restored.'
Assert (($global:InstallerTestCalls[1].Arguments -contains 'personal') -and ($global:InstallerTestCalls[1].Arguments -contains '--check')) 'Personal wrapper lost its profile.'
Assert ((Get-Location).Path -eq $Original) 'Working directory was not restored.'

Reset
& "$Repo/install.work.ps1" -AgentsOnly -TunnelId 'test.asse' -McpUrl 'https://test-8888.asse.devtunnels.ms/mcp/shared/'
Assert (@($global:InstallerTestCalls | Where-Object Name -eq npm).Count -eq 1) 'Work must install MCP dependencies.'
Assert ((@($global:InstallerTestCalls | Where-Object Name -eq npm)[0].Arguments[2]) -eq "$Repo/hindsight") 'npm must receive an absolute prefix.'
$Config = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'node' -and $_.Arguments[0] -like '*configure-agents.mjs' })
Assert ($Config.Count -eq 2 -and $Config[0].Arguments -contains '--check') 'Work must preflight before configuring.'
Assert ($Config[1].Arguments -contains 'test.asse') 'Work wrapper lost TunnelId.'
$Guidance = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments -contains "$Repo/install.conf-agents.yaml" })
Assert ($Guidance.Count -eq 1 -and $Guidance[0].Profile -eq 'work') 'Work must pass its profile to Dotbot guidance.'
Assert ($global:InstallerTestCalls[-1].Arguments[0] -like '*smoke.mjs') 'Work must run a real MCP smoke check.'

Reset
& "$Repo/install.personal.ps1" -DotbotArgs @('--only', 'link')
$Dotbot = @($global:InstallerTestCalls | Where-Object { $_.Name -eq 'python' -and $_.Arguments[0] -like '*dotbot/bin/dotbot' })
Assert ($Dotbot.Count -eq 2 -and $Dotbot[0].Arguments -contains '--only' -and $Dotbot[1].Arguments -contains '--only') 'Both Dotbot configurations must receive forwarded arguments.'
Assert (@($global:InstallerTestCalls | Where-Object Name -eq winget).Count -ge 16) 'Shared package installation was skipped.'
Assert (@($global:InstallerTestCalls | Where-Object Name -eq npm).Count -eq 0) 'Personal installer must not install Hindsight dependencies.'

foreach ($Failure in @('preflight', 'npm', 'git', 'dotbot', 'smoke')) {
    Reset
    $global:InstallerTestFail = $Failure
    $Threw = $false
    try { & "$Repo/install.work.ps1" } catch { $Threw = $true }
    Assert $Threw "Failure '$Failure' was ignored."
    Assert ((Get-Location).Path -eq $Original) 'Failed installation did not restore working directory.'
    Assert ($env:DOTFILES_PROFILE -eq 'test-previous-value') 'Failed installation did not restore profile environment.'
    if ($Failure -ne 'smoke') {
        Assert (@($global:InstallerTestCalls | Where-Object { $_.Name -eq 'node' -and $_.Arguments[0] -like '*configure-agents.mjs' -and $_.Arguments -notcontains '--check' }).Count -eq 0) 'Configuration applied after failed prerequisite.'
    }
}
Write-Host 'Installer checks passed (entrypoints, shared steps, argument forwarding, failures, directory restoration).'
