param(
    [switch]$AgentsOnly,
    [string[]]$DotbotArgs = @()
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/install.ps1" -Profile work @PSBoundParameters
