param(
    [string]$Model = 'gpt-6-luna',
    [string]$AuthPath,
    [string]$RuntimePath,
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
$source += "`n" + (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CopilotAuth.cs') -Raw -Encoding UTF8)
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
        if (!$RuntimePath) {
            if ($env:COPILOT_CLI_RESOLVED_DIST_DIR) {
                $runtimes = Get-ChildItem -Path (Join-Path $env:COPILOT_CLI_RESOLVED_DIST_DIR 'prebuilds\win32-*\runtime.node') -ErrorAction SilentlyContinue
            } else {
                $runtimes = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'copilot\pkg\win32-*\*\prebuilds\win32-*\runtime.node') -ErrorAction SilentlyContinue
            }
            $runtime = $runtimes | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($runtime) { $RuntimePath = $runtime.FullName }
        }
        if (!$RuntimePath -or !(Test-Path -LiteralPath $RuntimePath)) {
            throw 'Copilot native runtime not found. Install and sign in to Copilot CLI, or specify runtime.node with -RuntimePath.'
        }
        $credentials = New-Object SelectionTranslator.NativeCopilotAuth($node.Source, (Join-Path $PSScriptRoot 'copilot-auth.mjs'), $RuntimePath)
        $client = New-Object SelectionTranslator.CopilotClient($credentials, $Model)
    }
    if ($PSBoundParameters.ContainsKey('Probe')) {
        try { $client.TranslateToConsole($Probe) }
        finally { $client.Dispose() }
    } else {
        [SelectionTranslator.Desktop]::Run($client, $Model)
    }
}
