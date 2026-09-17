$ErrorActionPreference = "Stop"

$CONFIG = "../install.conf-win.yaml"
$DOTBOT_DIR = "dotbot"

$DOTBOT_BIN = "bin/dotbot"
$BASEDIR = $PSScriptRoot

Set-Location $BASEDIR
Get-Location

foreach ($PACKAGE in @(
    'Gyan.FFmpeg'
    '7zip.7zip'
    'jqlang.jq'
    'oschwartz10612.Poppler'
    'sharkdp.bat'
    'sharkdp.fd'
    'BurntSushi.ripgrep.MSVC'
    'junegunn.fzf'
    'ajeetdsouza.zoxide'
    'ImageMagick.ImageMagick'
    'sxyazi.yazi'
    'JesseDuffield.lazygit'
    'Neovim.Neovim'
    'Nushell.Nushell'
    'eza-community.eza'
    'max-sixty.worktrunk'
)) {
    if (winget list --id $PACKAGE --exact --source winget --accept-source-agreements | Select-String -Pattern $PACKAGE -SimpleMatch -Quiet) {
        # Native Nushell integration needs 0.74.4+ for safe Ctrl+T path quoting.
        if ($PACKAGE -eq 'junegunn.fzf' -and [version]((& fzf --version).Split(' ')[0]) -lt [version]'0.74.4') {
            winget upgrade --id $PACKAGE --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
            if ($LASTEXITCODE -ne 0) { throw 'Failed to upgrade fzf for Nushell integration.' }
        }
        continue
    }
    winget install --id $PACKAGE --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
}

Set-Location $DOTBOT_DIR
git submodule update --init --recursive
foreach ($PYTHON in ('python', 'python3')) {
    # Python redirects to Microsoft Store in Windows 10 when not installed
    if (& { $ErrorActionPreference = "SilentlyContinue"
            ![string]::IsNullOrEmpty((&$PYTHON -V))
            $ErrorActionPreference = "Stop" }) {
        &$PYTHON $(Join-Path $BASEDIR -ChildPath $DOTBOT_DIR | Join-Path -ChildPath $DOTBOT_BIN) -d $BASEDIR -c $CONFIG $Args
        return
    }
}
Write-Error "Error: Cannot find Python."
