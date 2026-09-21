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

# Exercise the actual switch entry point without fzf or a live Herdr session.
& {
    $Probe = @{ Arguments = @(); Branch = '^'; Existing = $true; Status = 0 }
    function Select-Branch { return $Probe.Branch }
    function Test-WorktrunkRef { return $Probe.Existing }
    function Get-RootWorkspaceId { return 'w-root' }
    function Test-Worktrunk {
        $global:LASTEXITCODE = 0
        if ($args[0] -eq 'list') { return '[{"branch":"main","path":"D:/repo","is_main":true}]' }
        $Probe.Arguments = @($args)
        $global:LASTEXITCODE = $Probe.Status
    }

    foreach ($Base in 'default', 'current') {
        foreach ($Existing in $true, $false) {
            $Probe.Existing = $Existing
            $Probe.Branch = if ($Existing) { '^' } else { 'weikai/redployImage' }
            $Probe.Status = if ($Existing) { 0 } else { 7 }
            $Status = Invoke-Switch 'Test-Worktrunk' 'C:\Program Files\Herdr\herdr.exe' 'D:/repo' 'w-child' $Base
            Assert-Equal $Status $Probe.Status 'execute failure must propagate'
            $Arguments = $Probe.Arguments
            $ExecuteArgs = $Arguments[($Arguments.IndexOf('--execute') + 1)..($Arguments.Count - 1)]
            $Expected = @('C:/Program Files/Herdr/herdr.exe', '--', 'worktree', 'open', '--workspace', 'w-root', '--branch', '{{ branch }}', '--label', '{{ branch }}', '--focus')
            Assert-Equal ($ExecuteArgs -join '|') ($Expected -join '|') 'open must use the resolved branch, not an MSYS worktree path or input shortcut'
            Assert-Equal ($Arguments -contains '--create') (-not $Existing) 'only new branches should be created'
            Assert-Equal ($Arguments -contains '--base') ($Base -eq 'current' -and -not $Existing) 'current-base creation should retain --base'
        }
    }
}

Write-Host 'PASS runner helpers and switch execution'
