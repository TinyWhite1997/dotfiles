# Run only on the Windows machine hosting Hindsight, under your signed-in user.
$ErrorActionPreference = 'Stop'
$State = Join-Path $HOME '.hindsight'
foreach ($File in @('venv\Scripts\hindsight-api.exe', '.env', 'client.json')) {
    if (!(Test-Path (Join-Path $State $File))) { throw "Missing $State\$File; see README.md." }
}
$User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Shell = (Get-Command pwsh).Source
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
foreach ($Service in @('api', 'tunnel')) {
    $Name = "Hindsight-$Service"
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        throw "$Name already exists. Manage it explicitly rather than overwriting a running service."
    }
    $Action = New-ScheduledTaskAction -Execute $Shell -WorkingDirectory $State `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$PSScriptRoot\run-service.ps1`" -Service $Service"
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null
    Start-ScheduledTask -TaskName $Name
    Write-Host "Started $Name (logs: $State\$Service.log)"
}
