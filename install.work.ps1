param(
    [switch]$AgentsOnly,
    [string]$TunnelId,
    [string]$McpUrl,
    [string[]]$DotbotArgs = @()
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/install.ps1" -Profile work @PSBoundParameters
