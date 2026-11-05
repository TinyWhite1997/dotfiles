# Real Windows filesystem checks; no package installation or user config writes.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$Tokens = $null
$Errors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile("$Repo/install.ps1", [ref]$Tokens, [ref]$Errors)
if ($Errors.Count) { throw $Errors[0] }
foreach ($Name in @('Refresh-Path', 'Get-DotbotPython', 'Repair-AgentJunctions')) {
    $Function = $Ast.Find({ param($Node) $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq $Name }, $true)
    if ($Function) { . ([scriptblock]::Create($Function.Extent.Text)) }
}
$OriginalPath = $env:Path
$Root = Join-Path ([IO.Path]::GetTempPath()) "dotfiles-windows-$([guid]::NewGuid())"
try {
    $env:Path = "$OriginalPath;$OriginalPath;$OriginalPath;C:\Dotfiles-Test-Only;c:\dotfiles-test-only\"
    Refresh-Path
    $Entries = @($env:Path -split ';' | Where-Object { $_ })
    $Unique = @($Entries | ForEach-Object { $_.TrimEnd('\').ToLowerInvariant() } | Select-Object -Unique)
    if ($Entries.Count -ne $Unique.Count) { throw 'Refresh-Path left duplicate entries; CMD can drop an oversized PATH.' }
    if ($Entries -notcontains 'C:\Dotfiles-Test-Only') { throw 'Lost process-only PATH entry.' }
    $Once = $env:Path
    Refresh-Path
    if ($env:Path -ne $Once) { throw 'Refresh-Path must be idempotent.' }
    & $env:ComSpec /d /c 'where powershell.exe' | Out-Null
    if ($LASTEXITCODE) { throw 'CMD cannot find PowerShell after PATH refresh.' }

    $AgentHome = Join-Path $Root 'home/.pi/agent'
    foreach ($Kind in @('skills', 'extensions')) {
        $Source = Join-Path $Root "pi/agent/$Kind/managed"
        $Destination = Join-Path $AgentHome "$Kind/managed"
        New-Item -ItemType Directory -Path $Source, (Split-Path $Destination) -Force | Out-Null
        Set-Content -LiteralPath "$Source/keep.txt" -Value 'keep source content'
        New-Item -ItemType Junction -Path $Destination -Target $Source | Out-Null
    }
    $Other = New-Item -ItemType Directory -Path "$Root/other"
    New-Item -ItemType Directory -Path "$Root/pi/agent/skills/unrelated", "$Root/pi/agent/skills/regular", "$Root/pi/agent/skills/symlink" -Force | Out-Null
    New-Item -ItemType Junction -Path "$AgentHome/skills/unrelated" -Target $Other.FullName | Out-Null
    New-Item -ItemType Directory -Path "$AgentHome/skills/regular" | Out-Null
    Set-Content -LiteralPath "$AgentHome/skills/regular/keep.txt" -Value 'keep user content'
    $Python = Get-DotbotPython
    & $Python -c "import os, sys; os.symlink(sys.argv[1], sys.argv[2], target_is_directory=True)" "$Root/pi/agent/skills/symlink" "$AgentHome/skills/symlink"
    if ($LASTEXITCODE) { throw 'Could not create test symlink.' }

    Repair-AgentJunctions -Repo $Root -Python $Python -AgentHome $AgentHome
    foreach ($Kind in @('skills', 'extensions')) {
        if ((Get-Item "$AgentHome/$Kind/managed").LinkType -ne 'SymbolicLink') { throw 'Legacy managed junction was not replaced.' }
        if ((Get-Content "$Root/pi/agent/$Kind/managed/keep.txt") -ne 'keep source content') { throw 'Junction target content was changed.' }
    }
    if ((Get-Item "$AgentHome/skills/unrelated").LinkType -ne 'Junction') { throw 'Touched unrelated junction.' }
    if ((Get-Content "$AgentHome/skills/regular/keep.txt") -ne 'keep user content') { throw 'Touched regular directory.' }
    if ((Get-Item "$AgentHome/skills/symlink").LinkType -ne 'SymbolicLink') { throw 'Touched existing symlink.' }
    Repair-AgentJunctions -Repo $Root -Python $Python -AgentHome $AgentHome

    $Config = Join-Path $Root 'links.yaml'
    Set-Content -LiteralPath $Config -Value "- link:`n    home/.pi/agent/skills/managed: pi/agent/skills/managed`n    home/.pi/agent/extensions/managed: pi/agent/extensions/managed"
    & $Python "$Repo/dotbot/bin/dotbot" -d $Root -c $Config
    if ($LASTEXITCODE) { throw 'Real Dotbot could not link repaired junction paths.' }
    & $Python "$Repo/dotbot/bin/dotbot" -d $Root -c $Config
    if ($LASTEXITCODE) { throw 'Real Dotbot reinstall was not idempotent.' }
    foreach ($Kind in @('skills', 'extensions')) {
        if ((Get-Item "$AgentHome/$Kind/managed").LinkType -ne 'SymbolicLink') { throw 'Expected a real symlink.' }
        if ((Get-Content "$AgentHome/$Kind/managed/keep.txt") -ne 'keep source content') { throw 'Lost source content.' }
    }
    Write-Host 'Windows installer checks passed (PATH deduplication, junction migration, data preservation, real Dotbot reinstall).'
} finally {
    $env:Path = $OriginalPath
    if (Test-Path $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
}
