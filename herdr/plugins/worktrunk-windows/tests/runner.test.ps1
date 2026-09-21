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
        Assert-Equal $args[0] '-C' 'every Worktrunk call must specify its source directory'
        Assert-Equal $args[1] 'D:/repo with spaces' 'source directory must remain one argument'
        if ($args[2] -eq 'list') {
            return '[{"branch":"main","path":"D:/repo with spaces","is_main":true},{"branch":"feature","path":"D:/worktrees/feature","is_main":false}]'
        }
        $Probe.Arguments = @($args)
        $global:LASTEXITCODE = $Probe.Status
    }

    foreach ($Base in 'default', 'current') {
        foreach ($Existing in $true, $false) {
            $Probe.Existing = $Existing
            $Probe.Branch = if ($Existing) { '^' } else { 'weikai/redployImage' }
            $Probe.Status = if ($Existing) { 0 } else { 7 }
            $Status = Invoke-Switch 'Test-Worktrunk' 'C:\Program Files\Herdr\herdr.exe' 'D:/repo with spaces' 'w-child' $Base
            Assert-Equal $Status $Probe.Status 'execute failure must propagate'
            $Arguments = $Probe.Arguments
            $ExecuteArgs = $Arguments[($Arguments.IndexOf('--execute') + 1)..($Arguments.Count - 1)]
            $Expected = @('C:/Program Files/Herdr/herdr.exe', '--', 'worktree', 'open', '--workspace', 'w-root', '--branch', '{{ branch }}', '--label', '{{ branch }}', '--focus')
            Assert-Equal ($ExecuteArgs -join '|') ($Expected -join '|') 'open must use the resolved branch, not an MSYS worktree path or input shortcut'
            Assert-Equal ($Arguments -contains '--create') (-not $Existing) 'only new branches should be created'
            Assert-Equal ($Arguments -contains '--base') ($Base -eq 'current' -and -not $Existing) 'current-base creation should retain --base'
        }
    }

    function Get-Command { return [PSCustomObject]@{ Source = 'Test-Fzf' } }
    function Test-Fzf { $global:LASTEXITCODE = 0; return 'feature' }
    function Test-Herdr { $global:LASTEXITCODE = 0; return '{"result":{"worktrees":[]}}' }
    $Probe.Status = 0
    Assert-Equal (Invoke-Remove 'Test-Worktrunk' 'Test-Herdr' 'D:/repo with spaces') 0 'remove should succeed'
    Assert-Equal ($Probe.Arguments -join '|') '-C|D:/repo with spaces|remove|--foreground|feature' 'remove must also target the source repository'
}

# Reproduce a popup starting outside the repo, using real Git and Worktrunk.
& {
    $Worktrunk = Get-WorktrunkCommand
    $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ('worktrunk-cwd-' + [guid]::NewGuid())
    $Repo = Join-Path $Temp 'repo with spaces'
    New-Item -ItemType Directory -Path $Repo | Out-Null
    Push-Location $Temp
    try {
        & git.exe init --quiet --initial-branch=main $Repo
        if ($LASTEXITCODE) { throw 'git init failed' }
        & git.exe -C $Repo -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=NUL commit --quiet --allow-empty -m init
        if ($LASTEXITCODE) { throw 'git commit failed' }
        function Select-Branch($Worktrees) {
            Assert-Equal $Worktrees[0].branch 'main' 'list must use the source repo, not the popup cwd'
            return $null
        }
        foreach ($Base in 'default', 'current') {
            Assert-Equal (Invoke-Switch $Worktrunk 'unused-herdr' $Repo 'w-test' $Base) 0 'switch picker must list the repo from another cwd'
        }
        Assert-Equal (Invoke-Remove $Worktrunk 'unused-herdr' $Repo) 0 'remove picker must list the repo from another cwd'
    } finally {
        Pop-Location
        Remove-Item -LiteralPath $Temp -Recurse -Force
    }
}

Write-Host 'PASS runner helpers, switch/remove execution, and real Worktrunk from a non-repo cwd'
