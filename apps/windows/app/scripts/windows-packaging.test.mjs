import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  KNOWN_LEGACY_WINDOWS_PAYLOAD,
  parseNsisListing,
  STABLE_EXTERNAL_BIN,
  WINDOWS_RESOURCE_ALLOWLIST,
  WINDOWS_RESOURCE_BUNDLE_ENTRIES,
  WINDOWS_RUNTIME_REPAIR_ARTIFACTS,
  partitionReleaseResources,
  validateExternalBin,
  validateEmbeddedCoreDigestPin,
  validateNsisAutomaticUpgradeFlow,
  validateNsisLegacyCleanup,
  validatePayloadEntries,
  validateReleaseFeatureTree,
  validateResourcesWhitelist,
  validateTauriRendererCommandSurface,
  validateTlsPolicySources,
  validateWindowsReplacementHelperSource,
} from './windows-packaging.mjs'

const installerSource = readFileSync(
  new URL('../src-tauri/packages/windows/installer.nsi', import.meta.url),
  'utf8',
)
const tauriLibSource = readFileSync(
  new URL('../src-tauri/src/lib.rs', import.meta.url),
  'utf8',
)
const tonoTransportSource = readFileSync(
  new URL('../src-tauri/src/tono/transport.rs', import.meta.url),
  'utf8',
)
const windowsReleaseWorkflowSource = readFileSync(
  new URL('../../../../.github/workflows/windows-release.yml', import.meta.url),
  'utf8',
)
const windowsServiceInstallerSource = readFileSync(
  new URL('../../service/src/bin/install_service.rs', import.meta.url),
  'utf8',
)
const windowsReleaseShSource = readFileSync(
  new URL(
    '../../../../tooling/scripts/build-windows-release.sh',
    import.meta.url,
  ),
  'utf8',
)
const windowsReleasePs1Source = readFileSync(
  new URL(
    '../../../../tooling/scripts/build-windows-release.ps1',
    import.meta.url,
  ),
  'utf8',
)
const canonicalGuiLaunchLine =
  '  nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" "$MainBinaryArgs"'

test('NSIS automatically upgrades without reinstall/uninstall choices', () => {
  assert.equal(validateNsisAutomaticUpgradeFlow(installerSource), null)

  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Call DetectExistingInstall',
        '; detector omitted',
      ),
    ),
    /must run from \.onInit/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(/SetErrorLevel 1638\r?\n    Quit/, 'Abort'),
    ),
    /downgrade_blocked must set a nonzero exit code and terminate/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      `${installerSource}\nFunction PageReinstall\nFunctionEnd`,
    ),
    /old reinstall\/uninstall choice flow/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'DetailPrint "Automatically upgrading',
        "ExecWait '$R1' $0\n    DetailPrint \"Automatically upgrading",
      ),
    ),
    /must not launch an old uninstaller/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayName"',
        'StrCpy $R0 "Tono"',
      ),
    ),
    /must read the authoritative NSIS DisplayName/,
  )
  for (const field of ['UninstallString', 'DisplayVersion']) {
    assert.match(
      validateNsisAutomaticUpgradeFlow(
        installerSource.replace(
          new RegExp(`^  ReadRegStr[^\\r\\n]*"${field}"`, 'm'),
          `  ; ${field} read omitted`,
        ),
      ),
      new RegExp(`must read the authoritative NSIS ${field}`),
    )
  }
  for (const predicate of [
    '"$R0$ExistingUninstallCommand$ExistingVersion" != ""',
    '$R0 != "${PRODUCTNAME}"',
    '$ExistingUninstallCommand == ""',
    '$ExistingVersion == ""',
  ]) {
    assert.match(
      validateNsisAutomaticUpgradeFlow(
        installerSource.replace(predicate, '; completeness check omitted'),
      ),
      /must reject every incomplete or foreign NSIS registry record/,
    )
  }
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'nsis_tauri_utils::SemverCompare $ExistingVersion "0.0.0-0"',
        '; malformed-version validation omitted',
      ),
    ),
    /must reject malformed SemVer/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        '  File /a "/oname=${MAINBINARYNAME}.exe.next" "${MAINBINARYSRCPATH}"',
        '  Delete "$APPDATA\\com.raydocs.tono\\owner-token"\n  File /a "/oname=${MAINBINARYNAME}.exe.next" "${MAINBINARYSRCPATH}"',
      ),
    ),
    /must not delete Tono application data/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        '!macro StartVergeService',
        '!macro StartVergeService\n  Delete "$APPDATA\\com.raydocs.tono\\owner-token"',
      ),
    ),
    /install macro StartVergeService must not mutate Tono application data/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        /(!macro RemoveVergeService[\s\S]*?)\$\{If\} \$ConfirmedExistingInstall == 1/,
        '$1${If} $UpdateMode == 1',
      ),
    ),
    /confirmed existing install|raw \/UPDATE/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Function .onInstFailed',
        'Function SneakyOldUninstaller\n  ReadRegStr $ExistingUninstallCommand SHCTX "${UNINSTKEY}" "UninstallString"\nFunctionEnd\n\nFunction .onInstFailed',
      ),
    ),
    /UninstallString must not be read outside/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Function .onInstFailed',
        "Function SneakyOldUninstaller\n  ExecWait '$ExistingUninstallCommand' $0\nFunctionEnd\n\nFunction .onInstFailed",
      ),
    ),
    /must not execute a registry-derived old uninstaller/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        /(Function \.onInstFailed[\s\S]*?)\$\{If\} \$ConfirmedExistingInstall = 1/,
        '$1${If} $ConfirmedExistingInstall = 0',
      ),
    ),
    /failed confirmed upgrades must preserve/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'File /a "/oname=${MAINBINARYNAME}.exe.next" "${MAINBINARYSRCPATH}"',
        'File "${MAINBINARYSRCPATH}"',
      ),
    ),
    /main GUI payload.*non-live \.exe\.next/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Delete /REBOOTOK "$INSTDIR\\${MAINBINARYNAME}.exe.rollback"',
        '; GUI rollback cleanup omitted',
      ),
    ),
    /does not clean the GUI replacement artifact: rollback/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'File /a "/oname={{this}}.next"',
        'File /a "/oname={{this}}"',
      ),
    ),
    /non-live \.next|must never overwrite a live external binary/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'nsExec::ExecToLog \'"$INSTDIR\\resources\\tono-service-install.exe" --replace-runtime\'',
        'nsExec::ExecToLog /TIMEOUT=180000 \'"$INSTDIR\\resources\\tono-service-install.exe" --replace-runtime\'',
      ),
    ),
    /must not terminate.*timeout/i,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(/ --replace-runtime'\r?\n/, "'\n"),
    ),
    /must delegate.*--replace-runtime/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Call RunMainBinary',
        '; passive relaunch omitted',
      ),
    ),
    /two guarded \.onInstSuccess branches/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        /(Function \.onInstSuccess[\s\S]*?)\$\{If\} \$ConfirmedExistingInstall = 1/,
        '$1${If} $PassiveMode = 1',
      ),
    ),
    /confirmed upgrades must relaunch/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        '  ; Auto close this page for passive mode',
        '  Call RunMainBinary\n\n  ; Auto close this page for passive mode',
      ),
    ),
    /must not force-launch fresh \/P/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        /(Function \.onInstSuccess[\s\S]*?)\$\{If\} \$\{Silent\}\r?\n    Return\r?\n  \$\{EndIf\}/,
        '$1; silent return omitted',
      ),
    ),
    /silent \/S installs, including \/S \/R/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Section Install',
        'Section Install\n  nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" ""',
      ),
    ),
    /single canonical RunMainBinary launcher/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        /(Function \.onInstSuccess\r?\n)/,
        '$1  nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" ""\n',
      ),
    ),
    /single canonical RunMainBinary launcher/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Function .onInstFailed',
        'Function AlternateGuiLauncher\n  Call RunMainBinary\nFunctionEnd\n\nFunction .onInstFailed',
      ),
    ),
    /only in the two guarded \.onInstSuccess branches/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource.replace(
        'Function .onInstFailed',
        'Function AlternateGuiLauncher\n  Exec \'"$INSTDIR\\${MAINBINARYNAME}.exe"\'\nFunctionEnd\n\nFunction .onInstFailed',
      ),
    ),
    /single canonical RunMainBinary launcher/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource
        .replace(
          canonicalGuiLaunchLine,
          `  ;${canonicalGuiLaunchLine.trimStart()}`,
        )
        .replace(
          'Section Install',
          `Section Install\n${canonicalGuiLaunchLine}`,
        ),
    ),
    /RunMainBinary must be reboot-gated/,
  )
  assert.match(
    validateNsisAutomaticUpgradeFlow(
      installerSource
        .replace(
          canonicalGuiLaunchLine,
          `  ;${canonicalGuiLaunchLine.trimStart()}`,
        )
        .replace(
          'Function .onInstSuccess',
          `Function .onInstSuccess\n${canonicalGuiLaunchLine}`,
        ),
    ),
    /RunMainBinary must be reboot-gated/,
  )
})

test('privileged upgrade helper coordinates Service, Mihomo, and GUI publication', () => {
  assert.equal(
    validateWindowsReplacementHelperSource(windowsServiceInstallerSource),
    null,
  )
  assert.match(
    validateWindowsReplacementHelperSource(
      windowsServiceInstallerSource.replace(
        'let app = app_replacement_candidate(&runtime)?;',
        'let app = runtime;',
      ),
    ),
    /validate the staged GUI before entering.*repair gate/,
  )
  assert.match(
    validateWindowsReplacementHelperSource(
      windowsServiceInstallerSource.replace(
        /runtime_candidate,\r?\n\s+app_candidate,/,
        'runtime_candidate,',
      ),
    ),
    /pass both Mihomo and GUI candidates/,
  )
  assert.match(
    validateWindowsReplacementHelperSource(
      windowsServiceInstallerSource.replace(
        'app_replacement.publish()?;',
        '// GUI publication omitted',
      ),
    ),
    /omits GUI transaction step: app_replacement\.publish/,
  )
  assert.match(
    validateWindowsReplacementHelperSource(
      windowsServiceInstallerSource
        .replace(
          'app_replacement.publish()?;',
          '// final GUI publication omitted',
        )
        .replace(
          'runtime_replacement.publish()?;',
          'app_replacement.publish()?;\n        runtime_replacement.publish()?;',
        ),
    ),
    /only then publish the GUI/,
  )
  assert.match(
    validateWindowsReplacementHelperSource(
      windowsServiceInstallerSource.replace(
        'suppress_windows_service_recovery(service)?;',
        '// SCM recovery suppression omitted',
      ),
    ),
    /recovery suppressed/,
  )
})

test('NSIS uninstall removes leftover user control-plane pins', () => {
  assert.match(
    installerSource,
    /Delete \/REBOOTOK "\$APPDATA\\\$\{BUNDLEID\}\\tono\\control-plane-pins\.json"/,
  )
  assert.match(
    installerSource,
    /Delete \/REBOOTOK "\$LOCALAPPDATA\\\$\{BUNDLEID\}\\tono\\control-plane-pins\.json"/,
  )
})

test('NSIS removes every known old payload on upgrade and uninstall', () => {
  const cleanup = [
    ...KNOWN_LEGACY_WINDOWS_PAYLOAD,
    ...WINDOWS_RUNTIME_REPAIR_ARTIFACTS,
  ]
    .map(
      (entry) => `Delete /REBOOTOK "$INSTDIR\\${entry.replaceAll('/', '\\')}"`,
    )
    .join('\n')
  const install = `Section Install\n!insertmacro RemoveVergeService\n!insertmacro StartVergeService\nSectionEnd`
  const template = `${cleanup}\n!insertmacro RemoveKnownLegacyPayload\n!insertmacro RemoveKnownLegacyPayload\nRMDir /REBOOTOK "$INSTDIR"\n${install}`
  assert.equal(validateNsisLegacyCleanup(template), null)
  assert.match(
    validateNsisLegacyCleanup(
      template.replace(
        'Delete /REBOOTOK "$INSTDIR\\resources\\set_dns.sh"',
        '',
      ),
    ),
    /set_dns\.sh/,
  )
  assert.match(
    validateNsisLegacyCleanup(
      `${cleanup}\n!insertmacro RemoveKnownLegacyPayload\nRMDir /REBOOTOK "$INSTDIR"`,
    ),
    /both upgrade\/install and uninstall/,
  )
  assert.match(
    validateNsisLegacyCleanup(
      template.replace('RMDir /REBOOTOK "$INSTDIR"', 'RMDir "$INSTDIR"'),
    ),
    /product root/,
  )
  assert.match(
    validateNsisLegacyCleanup(
      template.replace(
        '!insertmacro RemoveVergeService\n!insertmacro StartVergeService',
        '!insertmacro StartVergeService',
      ),
    ),
    /orphaned WFP/,
  )
})

test('release feature gate rejects synchronous traced WebView dispatch', () => {
  const safe = `tauri-runtime-wry v2.11.4\n└── tauri v2.11.5\n    └── clash-verge v0.0.5`
  assert.equal(validateReleaseFeatureTree(safe), null)
  assert.match(
    validateReleaseFeatureTree(
      `${safe}\n├── tauri-runtime-wry feature "tracing"\n│   └── tauri feature "tracing"`,
    ),
    /synchronous/,
  )
  assert.match(
    validateReleaseFeatureTree(`${safe}\n└── tauri-plugin-devtools v2.1.0`),
    /devtools/,
  )
})

test('release TLS gate requires proxy-free pinning and rejects verification bypasses', () => {
  const safe = {
    transport:
      'reqwest::Client::builder()\n.no_proxy()\n.resolve_to_addrs(bootstrap::API_HOST, &pinned)',
    webdav: 'reqwest::Client::builder().use_rustls_tls().build()',
    mediaUnlock: 'Client::builder().use_rustls_tls().build()',
    legacyNetwork: 'Client::builder().tls_backend_rustls().build()',
  }
  assert.equal(validateTlsPolicySources(safe), null)
  assert.equal(
    validateTlsPolicySources({ ...safe, transport: tonoTransportSource }),
    null,
    'the gate must accept the real shared proxy-free transport builder',
  )
  assert.equal(
    validateTlsPolicySources({
      ...safe,
      transport: `
        fn builder() -> reqwest::ClientBuilder {
          reqwest::Client::builder().no_proxy()
        }
        let client = Self::builder()
          .resolve_to_addrs(bootstrap::API_HOST, &pinned);
      `,
    }),
    null,
  )
  assert.match(
    validateTlsPolicySources({
      ...safe,
      transport:
        'reqwest::Client::builder()\n.resolve_to_addrs(bootstrap::API_HOST, &pinned)',
    }),
    /disable application-level proxy discovery/,
  )
  assert.match(
    validateTlsPolicySources({
      ...safe,
      transport: `
        fn builder() -> reqwest::ClientBuilder {
          reqwest::Client::builder()
        }
        let client = Self::builder()
          .resolve_to_addrs(bootstrap::API_HOST, &pinned);
      `,
    }),
    /disable application-level proxy discovery/,
  )
  for (const [field, bypass] of [
    ['webdav', '.danger_accept_invalid_certs(true)'],
    ['mediaUnlock', '.danger_accept_invalid_hostnames( true )'],
    ['legacyNetwork', '.danger_accept_invalid_certs( true )'],
  ]) {
    assert.match(
      validateTlsPolicySources({ ...safe, [field]: bypass }),
      /disables TLS certificate or hostname verification/,
    )
  }
})

test('Windows release stops when a native preflight command fails', () => {
  const payloadInputGatePattern =
    /- name: Prepare and validate the Windows payload inputs\r?\n\s+run: \|([\s\S]*?)\r?\n\s+- name:/
  const block = windowsReleaseWorkflowSource.match(payloadInputGatePattern)?.[1]
  assert.ok(block, 'release workflow is missing the payload-input gate')
  assert.ok(
    windowsReleaseWorkflowSource
      .replace(/\r?\n/g, '\r\n')
      .match(payloadInputGatePattern)?.[1],
    'release workflow payload-input gate must survive a Windows CRLF checkout',
  )
  const firstNativeCommandAt = block.indexOf('pnpm prebuild')
  assert.ok(firstNativeCommandAt >= 0, 'release workflow is missing prebuild')
  assert.ok(
    block.indexOf("$ErrorActionPreference = 'Stop'") < firstNativeCommandAt,
    'PowerShell errors must stop the release before native commands run',
  )
  assert.ok(
    block.indexOf('$PSNativeCommandUseErrorActionPreference = $true') <
      firstNativeCommandAt,
    'native command exit codes must stop the release workflow',
  )
  assert.match(
    windowsReleaseWorkflowSource,
    /- name: Inspect the built NSIS payload[\s\S]*Get-ChildItem -LiteralPath 'target\/release\/bundle\/nsis'[\s\S]*pnpm release:preflight --payload-only/,
    'the signed draft must be inspected as a real NSIS package',
  )
  assert.doesNotMatch(
    windowsReleaseWorkflowSource,
    /Get-ChildItem -LiteralPath 'src-tauri\/target\/release\/bundle\/nsis'/,
    'the NSIS inspection path must follow the Cargo workspace target directory',
  )

  const prepareCoreAt = windowsReleaseWorkflowSource.indexOf(
    '- name: Prepare the exact stable Mihomo and Windows resources',
  )
  const buildServiceAt = windowsReleaseWorkflowSource.indexOf(
    '- name: Build Tono Windows Service from the same commit',
  )
  assert.ok(
    prepareCoreAt >= 0,
    'release workflow must prepare Mihomo before Service',
  )
  assert.ok(
    prepareCoreAt < buildServiceAt,
    'release workflow must know the packaged Mihomo before compiling Service',
  )
  assert.match(
    windowsReleaseWorkflowSource,
    /pnpm prebuild -- x86_64-pc-windows-msvc --skip-windows-service/,
  )
  const serviceBlock = windowsReleaseWorkflowSource
    .slice(buildServiceAt)
    .split(/\r?\n\s+- name:/, 1)[0]
  const hashAt = serviceBlock.indexOf('Get-FileHash')
  const buildAt = serviceBlock.indexOf('cargo build')
  assert.ok(
    hashAt >= 0 && hashAt < buildAt,
    'Service build must hash Mihomo first',
  )
  assert.match(serviceBlock, /\$env:TONO_CORE_SHA256 = \$coreSha256/)
  assert.match(serviceBlock, /GITHUB_ENV/)
  assert.match(serviceBlock, /core-sha256\.txt/)
  assert.match(serviceBlock, /tono-service\.exe/)
  assert.match(serviceBlock, /tono-service-install\.exe/)
  assert.match(serviceBlock, /\.Contains\(\$coreSha256\)/)
})

test('local Windows release scripts write core-sha256.txt from the hashed sidecar', () => {
  assert.match(windowsReleaseShSource, /core-sha256\.txt/)
  assert.match(windowsReleaseShSource, /TONO_CORE_SHA256=/)
  assert.match(windowsReleasePs1Source, /core-sha256\.txt/)
  assert.match(windowsReleasePs1Source, /\$env:TONO_CORE_SHA256 = \$coreSha256/)
})

test('packaging rejects a Service that lacks the exact packaged Core pin', () => {
  const digest = '98'.repeat(32)
  assert.equal(
    validateEmbeddedCoreDigestPin(
      Buffer.from(`prefix:${digest}:suffix`, 'ascii'),
      digest,
      'tono-service.exe',
    ),
    null,
  )
  assert.match(
    validateEmbeddedCoreDigestPin(
      Buffer.from(`prefix:${'97'.repeat(32)}:suffix`, 'ascii'),
      digest,
      'tono-service.exe',
    ),
    /tono-service\.exe does not embed.*SHA-256 pin/,
  )
  assert.match(
    validateEmbeddedCoreDigestPin(Buffer.from('anything'), 'not-a-digest'),
    /missing or malformed/,
  )
})

test('release Tauri handler excludes unused native probes and secret-bearing reads', () => {
  assert.equal(validateTauriRendererCommandSurface(tauriLibSource), null)
  for (const command of [
    'test_delay',
    'get_runtime_yaml',
    'get_runtime_proxy_chain_config',
    'get_profiles',
    'read_profile_file',
    'entry_lightweight_mode',
  ]) {
    assert.match(
      validateTauriRendererCommandSurface(
        tauriLibSource.replace(
          '            cmd::open_app_dir,',
          `            cmd::open_app_dir,\n            cmd::${command},`,
        ),
      ),
      new RegExp(command),
    )
  }
})

test('externalBin accepts only the stable sidecar', () => {
  assert.equal(validateExternalBin([STABLE_EXTERNAL_BIN]), null)
  assert.match(validateExternalBin(['sidecar/verge-mihomo-alpha']), /alpha/)
  assert.match(
    validateExternalBin(['sidecar/tono-core', 'sidecar/verge-mihomo-alpha']),
    /exactly one/,
  )
  assert.match(validateExternalBin([]), /exactly one/)
})

test('tauri.conf.json resources match the Windows allowlist', () => {
  const tauri = JSON.parse(
    readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  )
  assert.equal(validateResourcesWhitelist(tauri.bundle.resources), null)
  assert.ok(WINDOWS_RESOURCE_ALLOWLIST.includes('core-sha256.txt'))
})

test('resources whitelist rejects whole-directory packaging', () => {
  assert.equal(
    validateResourcesWhitelist([...WINDOWS_RESOURCE_BUNDLE_ENTRIES]),
    null,
  )
  assert.match(validateResourcesWhitelist(['resources']), /whole resources/)
  assert.match(
    validateResourcesWhitelist([
      ...WINDOWS_RESOURCE_BUNDLE_ENTRIES,
      'resources/set_dns.sh',
    ]),
    /mismatch/,
  )
  assert.match(
    validateResourcesWhitelist(['resources/enableLoopback.exe']),
    /mismatch/,
  )
})

test('payload validator requires staged executables and rejects legacy junk', () => {
  const good = [
    { name: 'Tono.exe.next' },
    { name: 'tono-core.exe.next' },
    { name: 'resources/tono-service.exe' },
    { name: 'resources/tono-service-install.exe' },
    { name: 'resources/tono-service-uninstall.exe' },
    { name: 'resources/core-sha256.txt' },
    { name: 'resources/core-identity.json' },
  ]
  assert.equal(validatePayloadEntries(good), null)

  assert.match(
    validatePayloadEntries([...good, { name: 'verge-mihomo-alpha.exe' }]),
    /alpha Mihomo/,
  )
  assert.match(
    validatePayloadEntries([
      ...good,
      { name: 'resources/clash-verge-service' },
    ]),
    /forbidden Windows junk/,
  )
  assert.match(
    validatePayloadEntries([...good, { name: 'resources/set_dns.sh' }]),
    /forbidden Windows junk/,
  )
  assert.match(
    validatePayloadEntries(
      good.filter((entry) => entry.name !== 'tono-core.exe.next'),
    ),
    /missing stable Tono Core/,
  )
  assert.match(
    validatePayloadEntries(
      good.filter((entry) => entry.name !== 'resources/core-sha256.txt'),
    ),
    /core-sha256\.txt/,
  )
  assert.match(
    validatePayloadEntries(
      good.filter((entry) => entry.name !== 'Tono.exe.next'),
    ),
    /exactly one staged GUI basename Tono\.exe\.next/,
  )
  assert.match(
    validatePayloadEntries([...good, { name: 'Tono.exe' }]),
    /must not contain a live or repair GUI basename/,
  )
  assert.match(
    validatePayloadEntries([...good, { name: 'verge-mihomo.exe' }]),
    /must not contain a live, repair, or alternate stable Mihomo basename/,
  )
  assert.match(
    validatePayloadEntries([
      ...good,
      { name: 'verge-mihomo-x86_64-pc-windows-msvc.exe' },
    ]),
    /must not contain a live, repair, or alternate stable Mihomo basename/,
  )
})

test('NSIS listing parser accepts real 7zz column variants', () => {
  // Verbatim shapes from a real `7zz l -ba` of a Tauri NSIS installer:
  // blank date/time for entries without stored timestamps, blank compressed
  // size for solid-block members, backslash separators, directory attrs.
  const listing = [
    '                    .....        12288     30747870  $PLUGINSDIR/System.dll',
    '2026-04-19 14:41:36 .....        26494               $PLUGINSDIR/modern-wizard.bmp',
    '                    .....         9728               $PLUGINSDIR\\nsDialogs.dll',
    '2026-08-01 02:24:36 .....      1691856               $TEMP/MicrosoftEdgeWebview2Setup.exe',
    '2026-08-01 02:24:36 D....            0            0  resources',
    '                    .....      2895360               resources/tono-service.exe',
    'not a listing line',
    '',
  ].join('\n')
  const entries = parseNsisListing(listing)
  assert.deepEqual(
    entries.map((entry) => entry.name),
    [
      '$PLUGINSDIR/System.dll',
      '$PLUGINSDIR/modern-wizard.bmp',
      '$PLUGINSDIR/nsDialogs.dll',
      '$TEMP/MicrosoftEdgeWebview2Setup.exe',
      'resources/tono-service.exe',
    ],
  )
  assert.equal(entries[0].size, 12288)
  assert.equal(entries.at(-1).base, 'tono-service.exe')
  assert.deepEqual(parseNsisListing(''), [])
})

test('portable partition keeps only the allowlist', () => {
  const { allowed, rejected } = partitionReleaseResources([
    ...WINDOWS_RESOURCE_ALLOWLIST,
    'clash-verge-service',
    'set_dns.sh',
    'unset_dns.sh',
  ])
  assert.deepEqual(allowed.sort(), [...WINDOWS_RESOURCE_ALLOWLIST].sort())
  assert.deepEqual(rejected.sort(), [
    'clash-verge-service',
    'set_dns.sh',
    'unset_dns.sh',
  ])
})
