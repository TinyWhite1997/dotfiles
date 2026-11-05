param([string]$UserSid)
$ErrorActionPreference = 'Stop'
$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($UserSid -and $Identity.User.Value -ne $UserSid) { throw 'Approve UAC as the same user running the installer.' }
$Principal = New-Object System.Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $Process = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -UserSid $($Identity.User.Value)"
    if ($Process.ExitCode -ne 0) { throw 'AutoHotkey task registration failed.' }
    exit 0
}

$Exe = @(
    "$env:LOCALAPPDATA\Programs\AutoHotkey\v2\AutoHotkey64.exe"
    "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Exe) { throw 'AutoHotkey v2 is required; run the full Windows installer.' }
$Name = "Dotfiles-AutoHotkey-$($Identity.User.Value)"
$Script = Join-Path $PSScriptRoot 'hotkeys.ahk'
$Action = New-ScheduledTaskAction -Execute $Exe -Argument "`"$Script`"" -WorkingDirectory $PSScriptRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Identity.Name
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId $Identity.Name -LogonType Interactive -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $TaskPrincipal -Settings $Settings -Force | Out-Null
$Task = Get-ScheduledTask -TaskName $Name
if ($Task.Principal.RunLevel -ne 'Highest' -or $Task.Actions.Execute -ne $Exe -or $Task.Actions.Arguments -ne "`"$Script`"") {
    throw 'AutoHotkey startup task verification failed.'
}

# Remove the old startup entry only after the elevated replacement is registered.
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'hotkeys.ahk'
if (Test-Path $Startup) { Remove-Item -LiteralPath $Startup -Force }
Start-ScheduledTask -TaskName $Name
Write-Host "Registered and started $Name"
