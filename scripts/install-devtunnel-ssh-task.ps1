$ErrorActionPreference = 'Stop'
$Name = 'DevTunnel-SSH-ssh-cpc-weika-yyjq7'
$Directory = Join-Path $env:LOCALAPPDATA 'DevTunnelSsh'
$Cli = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Microsoft.devtunnel_Microsoft.Winget.Source_8wekyb3d8bbwe\devtunnel.exe'
if (-not (Test-Path -LiteralPath $Cli)) { throw 'Install Microsoft.devtunnel with winget first.' }

New-Item -ItemType Directory -Path $Directory -Force | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\devtunnel-ssh.ps1", "$PSScriptRoot\devtunnel-ssh.vbs" -Destination $Directory -Force
$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" `
    -Argument "//B //NoLogo `"$Directory\devtunnel-ssh.vbs`""
$Triggers = @(
    New-ScheduledTaskTrigger -AtLogOn -User $User
    New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
)
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Task = New-ScheduledTask -Action $Action -Trigger $Triggers -Settings $Settings -Principal $Principal `
    -Description 'Keep remote SSH available on localhost:2221 without opening console or authentication windows. Requires this user to be logged on.'
Register-ScheduledTask -TaskName $Name -InputObject $Task -Force | Out-Null
Start-ScheduledTask -TaskName $Name
Write-Host "Started $Name. Logs: $Directory"
