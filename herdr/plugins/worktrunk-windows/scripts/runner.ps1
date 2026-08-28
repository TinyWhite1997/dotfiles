[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

function Remove-VerbatimPrefix([string]$Path) {
    if ($Path -and $Path.StartsWith('\\?\')) { return $Path.Substring(4) }
    return $Path
}

function Convert-HerdrJson([string[]]$Lines) {
    return (($Lines -join "`n") | ConvertFrom-Json)
}

function Get-OptionalProperty([object]$Object, [string]$Name) {
    $Property = $Object.PSObject.Properties[$Name]
    if ($Property) { return $Property.Value }
    return $null
}

function Get-WorktrunkList([string[]]$Lines) {
    $Payload = Convert-HerdrJson $Lines
    if ($null -eq $Payload) { return @() }
    $ItemsProperty = Get-OptionalProperty $Payload 'items'
    $HasBranch = $null -ne $Payload.PSObject.Properties['branch']
    if ($Payload -is [array] -or $HasBranch) {
        $Items = @($Payload)
    } elseif ($null -ne $ItemsProperty) {
        $Items = @($ItemsProperty)
    } else {
        throw 'Unsupported Worktrunk list JSON schema.'
    }

    return @($Items | ForEach-Object {
        $Worktree = Get-OptionalProperty $_ 'worktree'
        $Path = Get-OptionalProperty $_ 'path'
        $Main = Get-OptionalProperty $_ 'is_main'
        if (-not $Path -and $Worktree) { $Path = Get-OptionalProperty $Worktree 'path' }
        if ($null -eq $Main -and $Worktree) { $Main = Get-OptionalProperty $Worktree 'main' }
        [PSCustomObject]@{
            branch = Get-OptionalProperty $_ 'branch'
            path = $Path
            is_main = $Main
        }
    })
}

function Get-WorktrunkCommand {
    foreach ($Name in 'git-wt.exe', 'git-wt', 'wt.exe', 'wt') {
        $Command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Command) { return $Command.Source }
    }
    throw 'Worktrunk was not found. Install it with: winget install max-sixty.worktrunk'
}

function Get-RootWorkspaceId([string]$HerdrBin, [string]$SourceCwd, [string]$Fallback) {
    try {
        $Reply = Convert-HerdrJson (& $HerdrBin worktree list --cwd $SourceCwd)
        if ($LASTEXITCODE -eq 0 -and $Reply.result.source.source_workspace_id) {
            return $Reply.result.source.source_workspace_id
        }
    } catch {}
    return $Fallback
}

function Test-WorktrunkShortcut([string]$Branch) {
    return $Branch -eq '^' -or $Branch -eq '-' -or $Branch.Contains(':')
}

function Test-WorktrunkRef([string]$SourceCwd, [string]$Branch) {
    & git.exe -C $SourceCwd show-ref --quiet --verify "refs/heads/$Branch"
    if ($LASTEXITCODE -eq 0) { return $true }
    & git.exe -C $SourceCwd show-ref --quiet --verify "refs/remotes/$Branch"
    return $LASTEXITCODE -eq 0
}

function New-SwitchArguments([string]$Branch, [string]$Base, [bool]$Existing) {
    $Arguments = @('switch', '--no-cd', '--format=json')
    if ($Existing) { return $Arguments + $Branch }
    $Arguments += @('--create', $Branch)
    if ($Base -eq 'current') { $Arguments += @('--base', '@') }
    return $Arguments
}

function Get-NormalizedPath([string]$Path) {
    return (Remove-VerbatimPrefix $Path).Replace('/', '\').TrimEnd('\')
}

function Select-Branch([object[]]$Worktrees, [string]$SourceCwd, [string]$Base) {
    $Refs = & git.exe -C $SourceCwd for-each-ref --format='%(refname) %(refname:short)' refs/heads
    $Candidates = @(@(
        $Worktrees | Where-Object branch | ForEach-Object branch
        $Refs | ForEach-Object {
            $Parts = $_ -split ' ', 2
            if ($Parts.Count -eq 2 -and $Parts[0] -notmatch '/HEAD$') { $Parts[1] }
        }
    ) | Sort-Object -Unique)
    if ($Candidates.Count -eq 0) { return $null }

    $Fzf = Get-Command fzf.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Fzf) { throw 'fzf was not found on PATH.' }
    $CreateFrom = if ($Base -eq 'current') { 'the current branch' } else { 'the default branch' }
    $Choice = @($Candidates | & $Fzf.Source --print-query --reverse --info=inline --border=rounded --prompt 'worktree > ' --header "Enter switches; type a new name to create from $CreateFrom; Esc cancels")
    if ($LASTEXITCODE -gt 1 -or $Choice.Count -eq 0) { return $null }
    return $Choice[-1].Trim()
}

function Invoke-Switch([string]$Worktrunk, [string]$HerdrBin, [string]$SourceCwd, [string]$SourceWorkspace, [string]$Base) {
    $ListLines = & $Worktrunk list --format=json
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    $Worktrees = Get-WorktrunkList $ListLines

    $Branch = Select-Branch $Worktrees $SourceCwd $Base
    if (-not $Branch) { return 0 }
    $Existing = (Test-WorktrunkShortcut $Branch) -or (Test-WorktrunkRef $SourceCwd $Branch)
    $SwitchArgs = New-SwitchArguments $Branch $Base $Existing
    $Result = Convert-HerdrJson (& $Worktrunk @SwitchArgs)
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }

    $WorktreePath = $Result.path
    if (-not $WorktreePath) {
        $WorktreePath = ($Worktrees | Where-Object { $_.branch -eq $Branch } | Select-Object -First 1).path
    }
    if (-not $WorktreePath) { throw "Worktrunk returned no worktree path for: $Branch" }

    $RootWorkspace = Get-RootWorkspaceId $HerdrBin $SourceCwd $SourceWorkspace
    & $HerdrBin worktree open --workspace $RootWorkspace --path $WorktreePath --label $Branch --focus
    return $LASTEXITCODE
}

function Invoke-Remove([string]$Worktrunk, [string]$HerdrBin, [string]$SourceCwd) {
    $ListLines = & $Worktrunk list --format=json
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    $Worktrees = Get-WorktrunkList $ListLines

    $Candidates = @($Worktrees | Where-Object { $_.branch -and -not $_.is_main } | ForEach-Object branch)
    if ($Candidates.Count -eq 0) {
        Write-Host 'No removable worktrees (only the main worktree exists).'
        return 0
    }

    $Fzf = Get-Command fzf.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Fzf) { throw 'fzf was not found on PATH.' }
    $Branch = @($Candidates | & $Fzf.Source --reverse --info=inline --border=rounded --prompt 'remove worktree > ')
    if ($LASTEXITCODE -ne 0 -or $Branch.Count -eq 0) { return 0 }
    $Branch = $Branch[-1].Trim()

    $Target = $Worktrees | Where-Object { $_.branch -eq $Branch } | Select-Object -First 1
    $WorkspaceId = $null
    if ($Target) {
        $TargetPath = Get-NormalizedPath $Target.path
        try {
            $HerdrWorktrees = (Convert-HerdrJson (& $HerdrBin worktree list --cwd $SourceCwd)).result.worktrees
            if ($LASTEXITCODE -eq 0) {
                $WorkspaceId = ($HerdrWorktrees |
                    Where-Object { (Get-NormalizedPath $_.path) -ieq $TargetPath } |
                    Select-Object -First 1).open_workspace_id
            }
        } catch {}
    }

    & $Worktrunk remove --foreground $Branch
    $Status = $LASTEXITCODE
    if ($Status -eq 0 -and $WorkspaceId) { & $HerdrBin workspace close $WorkspaceId }
    return $Status
}

# Let the small PowerShell test import the helpers without opening a pane.
if ($MyInvocation.InvocationName -eq '.') { return }

$Mode = $env:WORKTRUNK_HERDR_MODE
$SourceCwd = $env:WORKTRUNK_HERDR_SOURCE_CWD
$SourceWorkspace = $env:WORKTRUNK_HERDR_SOURCE_WORKSPACE
$HerdrBin = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
if (-not $Mode -or -not $SourceCwd -or -not $SourceWorkspace) {
    throw 'Worktrunk runner was started without Herdr source context.'
}

$Worktrunk = Get-WorktrunkCommand
$Status = if ($Mode -eq 'remove') {
    Invoke-Remove $Worktrunk $HerdrBin $SourceCwd
} else {
    Invoke-Switch $Worktrunk $HerdrBin $SourceCwd $SourceWorkspace $Mode
}

# The picker is temporary. Keep it open only when an operation failed.
if ($Status -eq 0 -and $env:HERDR_PANE_ID) { & $HerdrBin pane close $env:HERDR_PANE_ID }
exit $Status
