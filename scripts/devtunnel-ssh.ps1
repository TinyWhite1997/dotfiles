$ErrorActionPreference = 'Stop'
$Tunnel = 'ssh-cpc-weika-yyjq7.asse'
$Directory = Join-Path $env:LOCALAPPDATA 'DevTunnelSsh'
$Cli = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Microsoft.devtunnel_Microsoft.Winget.Source_8wekyb3d8bbwe\devtunnel.exe'
$Log = Join-Path $Directory 'watchdog.log'
$Child = $null
$Mutex = New-Object Threading.Mutex($false, 'Local\DevTunnelSsh-ssh-cpc-weika-yyjq7')
try {
    $Owned = $Mutex.WaitOne(0)
} catch [Threading.AbandonedMutexException] {
    $Owned = $true
}
if (-not $Owned) { $Mutex.Dispose(); exit 0 }
$Launcher = Get-Process -Id (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId

function Write-Log($Message) {
    if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) {
        Move-Item -LiteralPath $Log -Destination "$Log.1" -Force
    }
    Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) $Message"
}

function Test-Ssh {
    $Client = New-Object Net.Sockets.TcpClient
    try {
        $Connect = $Client.ConnectAsync('127.0.0.1', 2221)
        if (-not $Connect.Wait(5000)) { return $false }
        $Stream = $Client.GetStream()
        $Stream.ReadTimeout = 5000
        $Reader = New-Object IO.StreamReader($Stream)
        return $Reader.ReadLine() -match '^SSH-2\.0-'
    } catch [Net.Sockets.SocketException], [IO.IOException], [AggregateException] {
        Write-Log "SSH probe failed: $($_.Exception.Message)"
        return $false
    } finally {
        $Client.Dispose()
    }
}

try {
    while ($true) {
        if ($Launcher.HasExited) { return }
        Write-Log "Connecting to $Tunnel"
        $Child = Start-Process -FilePath $Cli -ArgumentList @('connect', $Tunnel) -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput "$Directory\connect.log" -RedirectStandardError "$Directory\connect.error.log"
        $null = $Child.Handle
        $Started = Get-Date
        while (-not $Child.WaitForExit(30000)) {
            if ($Launcher.HasExited) { return }
            if (((Get-Date) - $Started).TotalSeconds -ge 60 -and -not (Test-Ssh)) {
                Write-Log 'SSH probe unhealthy; restarting connector.'
                $Child.Kill()
                $Child.WaitForExit()
                break
            }
        }
        Write-Log "Connector exited: $($Child.ExitCode)"
        $Child.Dispose()
        $Child = $null

        # Integrated authentication never opens a browser or requests device-code input.
        $Child = Start-Process -FilePath $Cli -ArgumentList @('user', 'login', '--use-integrated-windows-auth') `
            -WindowStyle Hidden -PassThru -RedirectStandardOutput "$Directory\auth.log" `
            -RedirectStandardError "$Directory\auth.error.log"
        $null = $Child.Handle
        if (-not $Child.WaitForExit(60000)) {
            Write-Log 'Integrated authentication timed out.'
            $Child.Kill()
            $Child.WaitForExit()
        }
        Write-Log "Integrated authentication exited: $($Child.ExitCode)"
        $Child.Dispose()
        $Child = $null
        Start-Sleep -Seconds 5
    }
} finally {
    if ($null -ne $Child) {
        if (-not $Child.HasExited) { $Child.Kill() }
        $Child.Dispose()
    }
    $Launcher.Dispose()
    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}
