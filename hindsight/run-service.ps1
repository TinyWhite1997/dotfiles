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
    & devtunnel host $Config.tunnelId *> "$State\tunnel.log"
}
exit $LASTEXITCODE
