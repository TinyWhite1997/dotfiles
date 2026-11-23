param(
    [string]$Model = 'gpt-6-luna',
    [string]$AuthPath,
    [string]$CliPath,
    [string]$SdkPath,
    [string]$Probe,
    [switch]$Test,
    [switch]$Smoke,
    [switch]$Fixture
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell supplies WPF and the .NET Framework compiler without an SDK.
if ($PSVersionTable.PSEdition -eq 'Core') {
    & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -File $PSCommandPath @PSBoundParameters
    exit $LASTEXITCODE
}
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, UIAutomationClient, UIAutomationTypes, System.Net.Http, System.Web.Extensions, System.Windows.Forms, System.Drawing
$references = @('System.dll', 'System.Core.dll', 'System.Xaml.dll', 'System.Net.Http.dll', 'System.Web.Extensions.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll',
    [System.Windows.Window].Assembly.Location,
    [System.Windows.Media.Brushes].Assembly.Location,
    [System.Windows.Threading.Dispatcher].Assembly.Location,
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.AutomationPattern].Assembly.Location)
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'App.cs') -Raw -Encoding UTF8
$source += "`n" + (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CliClient.cs') -Raw -Encoding UTF8)
if ($Test -or $Smoke -or $Fixture) { $source += "`n" + (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Tests.cs') -Raw -Encoding UTF8) }
Add-Type -TypeDefinition $source -ReferencedAssemblies $references
if ($Fixture) {
    [SelectionTranslator.Tests]::Fixture()
} elseif ($Smoke) {
    [SelectionTranslator.Tests]::Smoke($PSCommandPath)
} elseif ($Test) {
    [SelectionTranslator.Tests]::Run()
} else {
    if ($AuthPath) {
        $client = New-Object SelectionTranslator.CopilotClient($AuthPath, $Model)
    } else {
        $node = Get-Command node.exe -ErrorAction Stop
        if (!$CliPath) { $CliPath = $env:COPILOT_CLI_PATH }
        if (!$CliPath) {
            $cli = Get-Command copilot.exe -ErrorAction SilentlyContinue
            if ($cli) { $CliPath = $cli.Source }
            else {
                $cli = Get-ChildItem -Path (Join-Path $HOME '.copilot-cli\*\copilot.exe') -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($cli) { $CliPath = $cli.FullName }
            }
        }
        if (!$CliPath -or !(Test-Path -LiteralPath $CliPath)) {
            throw 'Copilot CLI not found. Install it and sign in, or specify copilot.exe with -CliPath.'
        }
        if (!$SdkPath -and $env:COPILOT_CLI_RESOLVED_DIST_DIR) {
            $SdkPath = Join-Path $env:COPILOT_CLI_RESOLVED_DIST_DIR 'copilot-sdk\index.js'
        }
        if (!$SdkPath) {
            $sdk = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'copilot\pkg\win32-*\*\copilot-sdk\index.js') -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($sdk) { $SdkPath = $sdk.FullName }
        }
        if (!$SdkPath -or !(Test-Path -LiteralPath $SdkPath)) {
            throw 'Bundled Copilot SDK not found. Update the CLI, or specify copilot-sdk\index.js with -SdkPath.'
        }
        $client = New-Object SelectionTranslator.CliCopilotClient($node.Source, (Join-Path $PSScriptRoot 'copilot-bridge.mjs'), $CliPath, $SdkPath, $Model)
    }
    if ($PSBoundParameters.ContainsKey('Probe')) {
        try { $client.TranslateToConsole($Probe) }
        finally { $client.Dispose() }
    } else {
        [SelectionTranslator.Desktop]::Run($client, $Model)
    }
}
