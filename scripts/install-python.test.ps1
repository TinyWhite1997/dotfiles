$ErrorActionPreference = 'Stop'
$Tokens = $null
$Errors = $null
$Installer = Join-Path $PSScriptRoot '..\install.ps1'
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$Tokens, [ref]$Errors)
if ($Errors.Count) { throw $Errors[0] }
$Function = $Ast.Find({ param($Node) $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Get-DotbotPython' }, $true)
. ([scriptblock]::Create($Function.Extent.Text))
function Get-Command { $script:Commands }
function Test-NativePython { $global:LASTEXITCODE = $script:ExitCode }
$Store = [pscustomobject]@{ Source = 'C:\Users\test\AppData\Local\Microsoft\WindowsApps\python.exe' }
$Native = [pscustomobject]@{ Source = 'Test-NativePython' }
$script:ExitCode = 0
$script:Commands = @($Store)
if (Get-DotbotPython) { throw 'Selected Store Python' }
$script:Commands = @($Store, $Native)
if ((Get-DotbotPython) -ne $Native.Source) { throw 'Did not select native Python' }
$script:ExitCode = 1
if (Get-DotbotPython) { throw 'Selected failing Python' }
$script:Commands = @()
if (Get-DotbotPython) { throw 'Selected missing Python' }
Write-Host 'Dotbot Python selection checks passed (4 cases).'
