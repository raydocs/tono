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
function Test-TonoServiceExists {
    $service = Get-Service TonoService -ErrorAction SilentlyContinue
    if ($null -eq $service) { return $false }
    try { return $true } finally { $service.Dispose() }
}
# installer.nsi intentionally overrides /D= to protect the privileged runtime.
# Exercise that real Program Files location, not an unsupported test directory.
$target = Join-Path $env:ProgramFiles 'Tono'
$arp = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Tono'
if ((Test-Path $target) -or (Test-Path $arp) -or (Test-TonoServiceExists)) { throw 'Refusing a runner with an existing Tono installation.' }
$installers = @(Get-ChildItem -LiteralPath $CandidateDirectory -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Exactly one candidate installer is required.' }
$installer = $installers[0].FullName
$manifest = Get-Content (Join-Path $CandidateDirectory 'candidate-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '0.0.81' -or $manifest.candidateOnly -ne $true) { throw 'Not a 0.0.81 test candidate.' }
$expected = @($manifest.files | Where-Object name -eq $installers[0].Name)
if ($expected.Count -ne 1 -or (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[0].sha256) { throw 'Candidate installer digest mismatch.' }
function Invoke-Installer([string]$File, [string]$Arguments, [int]$ExpectedExit = 0) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(300000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installer timed out: $File"
    }
    if ($process.ExitCode -ne $ExpectedExit) { throw "Installer exit $($process.ExitCode), expected $ExpectedExit ($File)" }
}
function Dns-State {
    @(Get-DnsClientServerAddress | Sort-Object InterfaceIndex, AddressFamily | ForEach-Object {
        "$($_.InterfaceIndex)|$($_.AddressFamily)|$($_.ServerAddresses -join ',')"
    }) -join "`n"
}
function Assert-Installed {
    $service = Get-Service TonoService
    try {
        $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
    } finally {
        # An open ServiceController handle can defer SCM deletion during cleanup.
        $service.Dispose()
    }
    $pin = (Get-Content (Join-Path $target 'resources/core-sha256.txt') -Raw).Trim()
    $actual = (Get-FileHash (Join-Path $target 'tono-core.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($pin -ne $actual) { throw 'Installed Core and pin disagree.' }
    foreach ($name in @('Tono.exe', 'resources/tono-service.exe', 'resources/tono-service-install.exe', 'resources/tono-service-uninstall.exe', 'uninstall.exe')) {
        if (-not (Test-Path (Join-Path $target $name) -PathType Leaf)) { throw "Missing installed file: $name" }
    }
    if (Get-Process Tono -ErrorAction SilentlyContinue) { throw 'Silent install unexpectedly launched the GUI.' }
}
$beforeDns = Dns-State
$report = [ordered]@{ source = $manifest.source; version = $manifest.version; legacyLayoutRefused = $false; orphanFilesRefused = $false; freshInstall = $false; sameVersionRepair = $false; cleanupFailureRetained = $false; partialUninstallRetry = $false; uninstall = $false; dataPreserved = $false; dnsUnchanged = $false; physicalUpgradeQualified = $false }
$out = Join-Path $env:RUNNER_TEMP 'tono-installer-smoke.json'
$dataFile = Join-Path $env:APPDATA 'com.raydocs.tono/install-recovery-smoke.txt'
if (Test-Path $dataFile) { throw 'Refusing to overwrite an existing data sentinel.' }
New-Item -ItemType Directory -Force (Split-Path $dataFile) | Out-Null
Set-Content $dataFile 'keep-this-account-data' -NoNewline
try {
    # Fixture for the 32 layout/quoted registry contract, NOT a real historical32 execution.
    New-Item -ItemType Directory $target | Out-Null
    Set-Content (Join-Path $target 'Tono.exe') 'legacy-app-sentinel' -NoNewline
    Set-Content (Join-Path $target 'verge-mihomo.exe') 'legacy-core-sentinel' -NoNewline
    Set-Content (Join-Path $target 'tono-core.exe') 'unrelated-later-core-sentinel' -NoNewline
    New-Item $arp | Out-Null
    New-ItemProperty $arp -Name DisplayName -Value 'Tono' | Out-Null
    New-ItemProperty $arp -Name DisplayVersion -Value '0.0.32' | Out-Null
    New-ItemProperty $arp -Name InstallLocation -Value "`"$target`"" | Out-Null
    New-ItemProperty $arp -Name UninstallString -Value "`"$target\uninstall.exe`"" | Out-Null
    try {
        Invoke-Installer $installer '/S' 1638
        if ((Get-Content (Join-Path $target 'Tono.exe') -Raw) -ne 'legacy-app-sentinel' -or
            (Get-Content (Join-Path $target 'verge-mihomo.exe') -Raw) -ne 'legacy-core-sentinel' -or
            (Get-Content (Join-Path $target 'tono-core.exe') -Raw) -ne 'unrelated-later-core-sentinel' -or
            (Get-ItemProperty $arp).DisplayVersion -ne '0.0.32') { throw 'Legacy-layout refusal changed the old generation.' }
        $report.legacyLayoutRefused = $true
        Remove-Item $arp -Recurse
        Invoke-Installer $installer '/S' 1638
        if ((Get-Content (Join-Path $target 'verge-mihomo.exe') -Raw) -ne 'legacy-core-sentinel') { throw 'Unregistered files were overwritten.' }
        Remove-Item (Join-Path $target 'Tono.exe'), (Join-Path $target 'verge-mihomo.exe'), (Join-Path $target 'tono-core.exe')
        Set-Content (Join-Path $target 'sing-box.exe') 'remaining-second-runtime' -NoNewline
        Invoke-Installer $installer '/S' 1638
        if ((Get-Content (Join-Path $target 'sing-box.exe') -Raw) -ne 'remaining-second-runtime' -or (Test-Path $arp)) { throw 'A lone unregistered runtime was adopted or overwritten.' }
        $report.orphanFilesRefused = $true
        Write-Output 'PASS legacy32-layout fixture and unregistered files refused without overwriting'
    } finally {
        # Only our disposable fixture, never a customer recovery procedure.
        Remove-Item $arp -Recurse -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $target 'Tono.exe'), (Join-Path $target 'verge-mihomo.exe'), (Join-Path $target 'tono-core.exe'), (Join-Path $target 'sing-box.exe') -ErrorAction SilentlyContinue
    }
    Invoke-Installer $installer '/S'
    Assert-Installed
    $report.freshInstall = $true
    Write-Output 'PASS fresh silent install, Service running, installed Core pin, no GUI auto-launch'
    Invoke-Installer $installer '/S /UPDATE'
    Assert-Installed
    $report.sameVersionRepair = $true
    Write-Output 'PASS same-version replacement/repair and Service restart'

    $uninstaller = Join-Path $target 'uninstall.exe'
    # Invalid _?= must not redirect an embedded uninstaller into an unrelated directory.
    Invoke-Installer $uninstaller "/S _?=$env:RUNNER_TEMP" 1603
    Assert-Installed
    # The helper returns 2 when its now-stopped Service image cannot be removed. A safe network
    # is not a completed uninstall: keep files and ARP until cleanup can be retried.
    $serviceImage = Join-Path $env:ProgramData 'Tono/bin/tono-service.exe'
    $serviceLock = [IO.File]::Open($serviceImage, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        Invoke-Installer $uninstaller "/S _?=$target" 1603
        if (-not (Test-Path $arp) -or -not (Test-Path (Join-Path $target 'Tono.exe')) -or
            -not (Test-Path (Join-Path $target 'tono-core.exe'))) { throw 'Incomplete Service cleanup removed the generation or its record.' }
        $report.cleanupFailureRetained = $true
    } finally { $serviceLock.Dispose() }
    # Lock a historical payload with no DELETE sharing. The failure occurs AFTER the current
    # GUI/Core deletions, so this tests partial removal rather than a harmless init refusal.
    $legacy = Join-Path $target 'verge-mihomo.exe'
    Set-Content $legacy 'locked-legacy-core' -NoNewline
    $lock = [IO.File]::Open($legacy, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        Invoke-Installer $uninstaller "/S _?=$target" 1603
        if (-not (Test-Path $arp) -or -not (Test-Path $uninstaller) -or -not (Test-Path $legacy)) { throw 'Partial uninstall lost its record, uninstaller or locked payload.' }
        if ((Test-Path (Join-Path $target 'Tono.exe')) -or (Test-Path (Join-Path $target 'tono-core.exe'))) { throw 'Failure did not reach the intended partial-removal state.' }
    } finally { $lock.Dispose() }
    # Simulate a helper already deleted by an earlier attempt. The retained uninstaller must
    # still finish with its embedded helpers, keeping account data through the retry/reinstall.
    Remove-Item (Join-Path $target 'resources/tono-service-install.exe')
    Invoke-Installer $uninstaller "/S _?=$target"
    if ((Test-Path $arp) -or (Test-Path $legacy) -or (Test-TonoServiceExists)) { throw 'Retry did not finish the removal.' }
    if ((Get-Content $dataFile -Raw) -ne 'keep-this-account-data') { throw 'Account data changed during uninstall retry.' }
    $report.partialUninstallRetry = $true
    Invoke-Installer $installer '/S'
    Assert-Installed
    Write-Output 'PASS partial uninstall retained ARP, retried without installed helper, and reinstalled'
} catch {
    $report['primaryError'] = $_.Exception.Message
    Write-Warning "Primary installer smoke failure: $($_.Exception.Message)"
    throw
} finally {
    $uninstaller = Join-Path $target 'uninstall.exe'
    try {
        if (Test-Path $uninstaller) {
            # _?= keeps NSIS in this waited process instead of spawning a temp copy.
            Invoke-Installer $uninstaller "/S _?=$target"
        }
        for ($i = 0; $i -lt 30 -and (Test-TonoServiceExists); $i++) { Start-Sleep -Seconds 1 }
        if (Test-TonoServiceExists) { throw 'TonoService remains after uninstall.' }
        foreach ($name in @('Tono.exe', 'tono-core.exe', 'resources/tono-service.exe')) {
            if (Test-Path (Join-Path $target $name)) { throw "Runtime payload remains after uninstall: $name" }
        }
        $report.uninstall = $true
        $report.dataPreserved = ((Get-Content $dataFile -Raw) -eq 'keep-this-account-data')
        if (-not $report.dataPreserved) { throw 'Account data was not preserved.' }
        $report.dnsUnchanged = ((Dns-State) -eq $beforeDns)
        if (-not $report.dnsUnchanged) { throw 'Runner DNS changed across unconfigured install/repair/uninstall.' }
        Write-Output 'PASS uninstall removed Service/runtime payload and preserved DNS'
    } catch {
        $report['cleanupError'] = $_.Exception.Message
        Write-Warning "Cleanup failure: $($_.Exception.Message)"
        throw
    } finally {
        $report | ConvertTo-Json | Set-Content $out
        Remove-Item $dataFile -ErrorAction SilentlyContinue
    }
}
