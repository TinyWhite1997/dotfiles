param(
    [string]$Model = 'gpt-5.6-luna',
    [string]$AuthPath = (Join-Path $HOME '.pi\agent\auth.json'),
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
if ($Test -or $Smoke -or $Fixture) { $source += "`n" + (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Tests.cs') -Raw -Encoding UTF8) }
Add-Type -TypeDefinition $source -ReferencedAssemblies $references
if ($Fixture) {
    [SelectionTranslator.Tests]::Fixture()
} elseif ($Smoke) {
    [SelectionTranslator.Tests]::Smoke($PSCommandPath)
} elseif ($Test) {
    [SelectionTranslator.Tests]::Run()
} elseif ($PSBoundParameters.ContainsKey('Probe')) {
    $client = New-Object SelectionTranslator.CopilotClient($AuthPath, $Model)
    try { $client.TranslateToConsole($Probe) }
    finally { $client.Dispose() }
} else {
    [SelectionTranslator.Desktop]::Run($AuthPath, $Model)
}
