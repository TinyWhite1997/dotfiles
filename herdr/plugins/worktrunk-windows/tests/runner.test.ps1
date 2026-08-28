$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Runner = Join-Path $Root 'scripts\runner.ps1'
$Errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($Runner, [ref]$null, [ref]$Errors) | Out-Null
if ($Errors) { throw ($Errors | Out-String) }

. $Runner

function Assert-Equal($Actual, $Expected, $Message) {
    if ($Actual -cne $Expected) { throw "$Message`nExpected: $Expected`nActual: $Actual" }
}

Assert-Equal (Remove-VerbatimPrefix '\\?\C:\repo') 'C:\repo' 'verbatim path should be stripped'
Assert-Equal (Remove-VerbatimPrefix 'C:\repo') 'C:\repo' 'normal path should be unchanged'
$SwitchArgs = @(New-SwitchArguments 'feature' 'current' $false)
Assert-Equal $SwitchArgs[$SwitchArgs.IndexOf('--base') + 1] '@' 'new current-base branch must use @'
Assert-Equal $SwitchArgs[$SwitchArgs.IndexOf('--create') + 1] 'feature' 'new branch should be created'
$ExistingArgs = @(New-SwitchArguments 'main' 'current' $true)
if ($ExistingArgs -contains '--base' -or $ExistingArgs -contains '--create') { throw 'existing branch must only switch' }
if (-not (Test-WorktrunkShortcut 'pr:42') -or (Test-WorktrunkShortcut 'feature')) { throw 'shortcut detection is wrong' }
$Schema2 = @(Get-WorktrunkList @('{"items":[{"branch":"feature","worktree":{"path":"D:/worktrees/feature","main":false}}]}'))
Assert-Equal $Schema2[0].path 'D:/worktrees/feature' 'schema 2 path should be normalized'
if ($Schema2[0].is_main) { throw 'schema 2 main flag should be normalized' }

Write-Host 'PASS runner helpers'
