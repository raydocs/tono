# No administrator or live fault required: evaluate only the fault function with mocks.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\test-windows-qa.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "QA harness parse errors: $errors" }
$definition = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-CoreCrash'
}, $true)
if (-not $definition) { throw 'Invoke-CoreCrash is missing' }
. ([scriptblock]::Create($definition.Extent.Text))
function Get-TonoDiagnosis { $script:diagnosis }
function Get-Process { param($Id, $ErrorAction); $script:observedPid = $Id; $script:process }
function Stop-Process { param($InputObject, [switch]$Force); $script:killed = $InputObject }
function Write-QaEvent { param($Kind, $Stage, $Data); $script:eventPid = $Data.process_id }
function Reset-Case {
    $script:diagnosis = @{ available = $true; report = @{ service = @{
        code = 0; data = @{ is_active = $true; core_pid = 345 }
    } } }
    $script:baselineDiagnosis = @{ report = @{ service = @{ data = @{ core_pid = 123 } } } }
    $script:process = [pscustomobject]@{ Id = 345; ProcessName = 'tono-core' }
    $script:killed = $null; $script:observedPid = $null; $script:eventPid = $null
}
function Assert-Refused {
    $refused = $false
    try { Invoke-CoreCrash } catch { $refused = $true }
    if (-not $refused -or $null -ne $script:killed -or $null -ne $script:eventPid) {
        throw 'an unproven fault target was not safely refused'
    }
}
foreach ($name in @('tono-core', 'TONO-CORE', 'mihomo', 'verge-mihomo')) {
    Reset-Case; $script:process.ProcessName = $name; Invoke-CoreCrash
    if ($script:observedPid -ne 345 -or $script:eventPid -ne 345 -or
        -not [object]::ReferenceEquals($script:killed, $script:process)) {
        throw 'fault did not use the fresh Service-owned process object'
    }
}
foreach ($name in @('fake-mihomo', 'mihomo-updater', 'Tono', 'tono-service')) {
    Reset-Case; $script:process.ProcessName = $name; Assert-Refused
}
Reset-Case; $script:process = $null; Assert-Refused
Reset-Case; $script:diagnosis.report.service.data.core_pid = 0; Assert-Refused
Reset-Case; $script:diagnosis.report.service.data.is_active = $false; Assert-Refused
Reset-Case; $script:diagnosis.report.service.code = 1; Assert-Refused
Reset-Case; $script:diagnosis.available = $false; Assert-Refused
Reset-Case; $script:diagnosis.error = 'transport failed'; Assert-Refused
Write-Output 'PASS: 14 Core fault targeting cases; no real process was stopped'
