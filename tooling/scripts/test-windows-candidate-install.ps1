[CmdletBinding()]
param([Parameter(Mandatory)][string]$CandidateDirectory)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
# This changes Service/installation state. It must never run on the owner's PC
# or a persistent/self-hosted runner by accident.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Installer smoke tests require an ephemeral GitHub-hosted Windows runner.'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator runner required.' }
$target = Join-Path $env:ProgramFiles 'Tono-CI-Candidate'
if ((Test-Path $target) -or (Get-Service TonoService -ErrorAction SilentlyContinue)) { throw 'Refusing a runner with an existing Tono installation.' }
$installers = @(Get-ChildItem -LiteralPath $CandidateDirectory -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Exactly one candidate installer is required.' }
$installer = $installers[0].FullName
$manifest = Get-Content (Join-Path $CandidateDirectory 'candidate-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '0.0.72' -or $manifest.candidateOnly -ne $true) { throw 'Not a 0.0.72 test candidate.' }
$expected = @($manifest.files | Where-Object name -eq $installers[0].Name)
if ($expected.Count -ne 1 -or (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[0].sha256) { throw 'Candidate installer digest mismatch.' }
function Invoke-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(300000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installer timed out: $File"
    }
    if ($process.ExitCode -ne 0) { throw "Installer failed or requires reboot: $($process.ExitCode) ($File)" }
}
function Dns-State {
    @(Get-DnsClientServerAddress | Sort-Object InterfaceIndex, AddressFamily | ForEach-Object {
        "$($_.InterfaceIndex)|$($_.AddressFamily)|$($_.ServerAddresses -join ',')"
    }) -join "`n"
}
function Assert-Installed {
    $service = Get-Service TonoService
    $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
    $pin = (Get-Content (Join-Path $target 'resources/core-sha256.txt') -Raw).Trim()
    $actual = (Get-FileHash (Join-Path $target 'tono-core.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($pin -ne $actual) { throw 'Installed Core and pin disagree.' }
    foreach ($name in @('Tono.exe', 'resources/tono-service.exe', 'resources/tono-service-install.exe', 'resources/tono-service-uninstall.exe', 'uninstall.exe')) {
        if (-not (Test-Path (Join-Path $target $name) -PathType Leaf)) { throw "Missing installed file: $name" }
    }
    if (Get-Process Tono -ErrorAction SilentlyContinue) { throw 'Silent install unexpectedly launched the GUI.' }
}
$beforeDns = Dns-State
$report = [ordered]@{ source = $manifest.source; version = $manifest.version; freshInstall = $false; sameVersionRepair = $false; uninstall = $false; dnsUnchanged = $false; physicalUpgradeQualified = $false }
$out = Join-Path $env:RUNNER_TEMP 'tono-installer-smoke.json'
try {
    Invoke-Installer $installer "/S /D=$target"
    Assert-Installed
    $report.freshInstall = $true
    Write-Output 'PASS fresh silent install, Service running, installed Core pin, no GUI auto-launch'
    Invoke-Installer $installer "/S /UPDATE /D=$target"
    Assert-Installed
    $report.sameVersionRepair = $true
    Write-Output 'PASS same-version replacement/repair and Service restart'
} finally {
    $uninstaller = Join-Path $target 'uninstall.exe'
    try {
        if (Test-Path $uninstaller) {
            # _?= keeps NSIS in this waited process instead of spawning a temp copy.
            Invoke-Installer $uninstaller "/S _?=$target"
        }
        for ($i = 0; $i -lt 30 -and (Get-Service TonoService -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
        if (Get-Service TonoService -ErrorAction SilentlyContinue) { throw 'TonoService remains after uninstall.' }
        foreach ($name in @('Tono.exe', 'tono-core.exe', 'resources/tono-service.exe')) {
            if (Test-Path (Join-Path $target $name)) { throw "Runtime payload remains after uninstall: $name" }
        }
        $report.uninstall = $true
        $report.dnsUnchanged = ((Dns-State) -eq $beforeDns)
        if (-not $report.dnsUnchanged) { throw 'Runner DNS changed across unconfigured install/repair/uninstall.' }
        Write-Output 'PASS uninstall removed Service/runtime payload and preserved DNS'
    } finally {
        $report | ConvertTo-Json | Set-Content $out
    }
}
