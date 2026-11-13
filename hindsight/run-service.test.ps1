# No external services or scheduled tasks are changed by these tests.
$ErrorActionPreference = 'Stop'
$Root = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$Runner = Join-Path $PSScriptRoot 'run-service.ps1'
$Shell = (Get-Command pwsh).Source
New-Item "$Root/.hindsight" -ItemType Directory -Force | Out-Null
Set-Content "$Root/.hindsight/client.json" '{"tunnelId":"test.asse"}'
try {
    foreach ($Case in @('clean', 'crash', 'healthy', 'not authorized', 'Unauthorized', 'HTTP 403 Forbidden', 'stderr 401')) {
        # A real native child stays alive after the auth error: the runner must stop it.
        $Native = Join-Path $Root 'native.ps1'
        $Mode = switch ($Case) {
            'clean' { 'Write-Output "normal shutdown"; exit 0' }
            'crash' { 'Write-Output "process crashed"; exit 7' }
            'healthy' { 'Write-Output "ready"; Start-Sleep -Seconds 3; Write-Output "healthy completed"; exit 0' }
            'stderr 401' { '[Console]::Error.WriteLine("stderr 401"); Start-Sleep -Seconds 30' }
            default { "Write-Output '$Case'; Start-Sleep -Seconds 30" }
        }
        Set-Content $Native $Mode
        $Wrapper = Join-Path $Root 'wrapper.ps1'
        Set-Content $Wrapper @"
Set-Variable HOME '$($Root.Replace("'", "''"))' -Force
function Start-Process {
    param(`$FilePath, `$ArgumentList, [switch]`$PassThru, [switch]`$NoNewWindow, `$RedirectStandardOutput, `$RedirectStandardError)
    Microsoft.PowerShell.Management\Start-Process '$($Shell.Replace("'", "''"))' -ArgumentList @('-NoProfile', '-File', '`"$($Native.Replace("'", "''"))`"') -PassThru -NoNewWindow -RedirectStandardOutput `$RedirectStandardOutput -RedirectStandardError `$RedirectStandardError
}
& '$($Runner.Replace("'", "''"))' -Service tunnel
exit `$LASTEXITCODE
"@
        $Out = Join-Path $Root 'stdout.log'
        $Err = Join-Path $Root 'stderr.log'
        $Process = Start-Process $Shell -ArgumentList @('-NoProfile', '-File', "`"$Wrapper`"") -PassThru -RedirectStandardOutput $Out -RedirectStandardError $Err
        if (!$Process.WaitForExit(10000)) {
            $Process.Kill($true)
            throw "$Case did not stop the native process within 10 seconds."
        }
        if ($Process.ExitCode -ne 1) { throw "$Case returned $($Process.ExitCode), expected 1." }
        $Log = (Get-Content "$Root/.hindsight/tunnel.log","$Root/.hindsight/tunnel.err.log" -Raw) -join "`n"
        $Expected = switch ($Case) { 'clean' { 'normal shutdown' }; 'crash' { 'process crashed' }; 'healthy' { 'healthy completed' }; default { $Case } }
        if (!$Log.Contains($Expected)) { throw "$Case was not written to tunnel.log." }
        Write-Host "PASS: $Case exits with failure for Task Scheduler."
    }
} finally {
    Remove-Item $Root -Recurse -Force
}
