param([Parameter(Mandatory)][ValidateSet('api', 'tunnel')][string]$Service)
$ErrorActionPreference = 'Stop'
$State = Join-Path $HOME '.hindsight'
Set-Location $State
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'

if ($Service -eq 'api') {
    & "$State\venv\Scripts\hindsight-api.exe" --host 127.0.0.1 --port 8888 *> "$State\api.log"
} else {
    $Config = Get-Content "$State\client.json" -Raw | ConvertFrom-Json
    $Logs = @("$State\tunnel.log", "$State\tunnel.err.log")
    $Process = Start-Process devtunnel -ArgumentList @('host', $Config.tunnelId) -PassThru -NoNewWindow `
        -RedirectStandardOutput $Logs[0] -RedirectStandardError $Logs[1]
    try {
        while (!$Process.WaitForExit(1000)) {
            # ponytail: scan per-launch logs; use streaming reads if log volume becomes significant.
            if (Select-String -Path $Logs -Pattern 'not authorized|unauthorized|forbidden|\b401\b|\b403\b' -Quiet) {
                throw 'Tunnel authorization failed; Task Scheduler will restart it. See tunnel logs.'
            }
        }
    } finally {
        if (!$Process.HasExited) { $Process.Kill($true) }
        $Process.WaitForExit()
        $Process.Dispose()
    }
}
# These services must stay running; even a clean exit needs a scheduler restart.
exit 1
