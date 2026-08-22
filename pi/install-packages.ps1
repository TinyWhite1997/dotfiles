$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    Write-Host "pi not on PATH; skip third-party packages"
    exit 0
}

Get-Content (Join-Path $root "agent/packages") | ForEach-Object {
    $pkg = $_.Trim()
    if (-not $pkg -or $pkg.StartsWith("#")) { return }
    & pi install $pkg
    if ($LASTEXITCODE -ne 0) { throw "pi install $pkg failed" }
}

if (Get-Command bash -ErrorAction SilentlyContinue) {
    & bash (Join-Path $root "sync-packages.sh")
}
