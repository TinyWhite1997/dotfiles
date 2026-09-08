[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('default', 'current', 'remove')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$HerdrBin = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
$Context = $env:HERDR_PLUGIN_CONTEXT_JSON | ConvertFrom-Json
$Cwd = if ($Context.workspace_cwd) { $Context.workspace_cwd } else { $Context.focused_pane_cwd }
$WorkspaceId = $env:HERDR_WORKSPACE_ID

if (-not $Cwd -or -not $WorkspaceId) {
    throw 'Herdr did not supply the source pane context.'
}

$Runner = Join-Path $PSScriptRoot 'runner.ps1'
$OpenArgs = @(
    'plugin', 'pane', 'open',
    '--plugin', 'worktrunk.windows',
    '--entrypoint', 'picker',
    '--cwd', $Cwd,
    '--focus'
)
foreach ($entry in @(
    "WORKTRUNK_HERDR_MODE=$Mode",
    "WORKTRUNK_HERDR_RUNNER=$Runner",
    "WORKTRUNK_HERDR_SOURCE_CWD=$Cwd",
    "WORKTRUNK_HERDR_SOURCE_WORKSPACE=$WorkspaceId"
)) {
    $OpenArgs += @('--env', $entry)
}

& $HerdrBin @OpenArgs | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not open the Worktrunk picker popup.'
}
