/**
 * Shared Windows packaging allowlist for Test 6+.
 *
 * Test 5 shipped dual Mihomo (stable + alpha) and ~4.8 MB of Unix helpers because:
 *   - externalBin historically listed alpha
 *   - bundle.resources was the whole "resources" directory
 *   - portable scripts re-zipped that whole directory after build
 *
 * Keep this module as the single source of truth for config preflight, portable zips,
 * and NSIS payload inspection.
 */

export const WINDOWS_RESOURCE_ALLOWLIST = Object.freeze([
  'Country.mmdb',
  'geoip.dat',
  'geosite.dat',
  'enableLoopback.exe',
  'tono-service.exe',
  'tono-service-install.exe',
  'tono-service-uninstall.exe',
  'core-sha256.txt',
])

export const WINDOWS_RESOURCE_BUNDLE_ENTRIES = Object.freeze(
  WINDOWS_RESOURCE_ALLOWLIST.map((name) => `resources/${name}`),
)

export const STABLE_EXTERNAL_BIN = 'sidecar/verge-mihomo'

export const FORBIDDEN_PAYLOAD_NAME_PATTERNS = Object.freeze([
  /verge-mihomo-alpha/i,
  /clash-verge-service/i,
  /^set_dns\.sh$/i,
  /^unset_dns\.sh$/i,
])

// Exact paths emitted by pre-0.0.6 Windows bundles but deliberately absent from the current
// payload allowlist. Because generated NSIS removal only knows the *current* manifest, the custom
// template must delete these names explicitly on upgrade and uninstall.
export const KNOWN_LEGACY_WINDOWS_PAYLOAD = Object.freeze([
  'verge-mihomo-alpha.exe',
  'resources/clash-verge-service',
  'resources/clash-verge-service-install',
  'resources/clash-verge-service-uninstall',
  'resources/clash-verge-service.exe',
  'resources/clash-verge-service-install.exe',
  'resources/clash-verge-service-uninstall.exe',
  'resources/set_dns.sh',
  'resources/unset_dns.sh',
])

export const WINDOWS_RUNTIME_REPAIR_ARTIFACTS = Object.freeze([
  'verge-mihomo.exe.next',
  'verge-mihomo.exe.rollback',
  'verge-mihomo.exe.restore',
  'verge-mihomo.exe.publish',
])

// These inherited Clash Verge commands are not used by any route in the Tono
// product shell. Registering them would nevertheless let any compromised
// WebView read generated runtime/profile secrets or turn the native process
// into an arbitrary host/port probe.
export const FORBIDDEN_TAURI_RENDERER_COMMANDS = Object.freeze([
  'test_delay',
  'get_runtime_config',
  'get_runtime_yaml',
  'get_runtime_logs',
  'get_runtime_proxy_chain_config',
  'get_profiles',
  'read_profile_file',
  'view_profile',
  'entry_lightweight_mode',
])

/**
 * Keep release invoke capability at the product boundary. The Rust functions
 * may remain compiled while legacy modules are being retired, but they must
 * not be callable by renderer JavaScript.
 *
 * @param {string} source src-tauri/src/lib.rs source
 * @returns {string | null}
 */
export function validateTauriRendererCommandSurface(source) {
  const handler = String(source).match(
    /tauri::generate_handler!\[([\s\S]*?)\]\s*\n\s*}/,
  )?.[1]
  if (!handler) {
    return 'src-tauri/src/lib.rs is missing the Tono generate_handler command list'
  }

  for (const command of FORBIDDEN_TAURI_RENDERER_COMMANDS) {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?:^|\\s)(?:cmd::)?${escaped}\\s*,`, 'm').test(handler)) {
      return `release Tauri handler exposes forbidden legacy renderer command: ${command}`
    }
  }
  return null
}

/**
 * Validate the custom template's migration half of the stable-only payload contract.
 * A clean new installer is not enough: an upgrade has to remove junk copied by an older one,
 * and the uninstaller has to do the same when no upgrade ever ran.
 *
 * @param {string} source installer.nsi source
 * @returns {string | null}
 */
export function validateNsisLegacyCleanup(source) {
  const text = String(source)
  for (const relative of [
    ...KNOWN_LEGACY_WINDOWS_PAYLOAD,
    ...WINDOWS_RUNTIME_REPAIR_ARTIFACTS,
  ]) {
    const windowsPath = relative.replaceAll('/', '\\')
    const statement = `Delete /REBOOTOK "$INSTDIR\\${windowsPath}"`
    if (!text.includes(statement)) {
      return `installer.nsi does not remove legacy payload path: ${relative}`
    }
  }
  const uses =
    text.match(/!insertmacro\s+RemoveKnownLegacyPayload/g)?.length ?? 0
  if (uses < 2) {
    return 'RemoveKnownLegacyPayload must run on both upgrade/install and uninstall'
  }
  if (!text.includes('RMDir /REBOOTOK "$INSTDIR"')) {
    return 'installer.nsi must schedule the product root after locked legacy payload deletion'
  }
  const installSection =
    text.match(/Section Install\b([\s\S]*?)SectionEnd/)?.[1] ?? ''
  if (
    !/!insertmacro\s+RemoveVergeService[\s\S]*!insertmacro\s+StartVergeService/.test(
      installSection,
    )
  ) {
    return 'fresh/repair install must clean orphaned WFP state before starting TonoService'
  }
  return null
}

/**
 * Guard Tono's unattended in-place upgrade contract. Existing versions must be classified from
 * .onInit (including /S), application data must be preserved, and every ambiguous/forbidden
 * migration must terminate the installer rather than merely skip a custom NSIS page.
 *
 * @param {string} source installer.nsi source
 * @returns {string | null}
 */
export function validateNsisAutomaticUpgradeFlow(source) {
  const text = String(source)
  const obsoleteInteractiveTokens = [
    'PageReinstall',
    'PageLeaveReinstall',
    'ReinstallPageCheck',
    'NSD_CreateRadioButton',
    'uninstallBeforeInstalling',
    'dontUninstall',
  ]
  const obsolete = obsoleteInteractiveTokens.find((token) =>
    text.includes(token),
  )
  if (obsolete) {
    return `installer.nsi still exposes the old reinstall/uninstall choice flow: ${obsolete}`
  }

  const detector = text.match(
    /Function DetectExistingInstall\b([\s\S]*?)FunctionEnd/,
  )?.[1]
  if (!detector) return 'installer.nsi is missing DetectExistingInstall'

  const onInit =
    text.match(/Function \.onInit\b([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  if (!/Call\s+DetectExistingInstall/.test(onInit)) {
    return 'DetectExistingInstall must run from .onInit so silent installs are classified'
  }
  if (/Page\s+custom\s+DetectExistingInstall/.test(text)) {
    return 'DetectExistingInstall must not rely on a custom page callback'
  }
  for (const field of ['DisplayName', 'UninstallString', 'DisplayVersion']) {
    if (
      !new RegExp(
        `ReadRegStr[^\\r\\n]*\\$\\{UNINSTKEY\\}[^\\r\\n]*"${field}"`,
      ).test(detector)
    ) {
      return `DetectExistingInstall must read the authoritative NSIS ${field}`
    }
  }
  if (
    !/ReadRegStr\s+\$ExistingUninstallCommand[^\r\n]*"UninstallString"/.test(
      detector,
    )
  ) {
    return 'DetectExistingInstall must keep UninstallString in its non-executable dedicated variable'
  }
  if (
    !/"\$R0\$ExistingUninstallCommand\$ExistingVersion"\s*!=\s*""/.test(
      detector,
    ) ||
    !/\$R0\s*!=\s*"\$\{PRODUCTNAME\}"/.test(detector) ||
    !/\$ExistingUninstallCommand\s*==\s*""/.test(detector) ||
    !/\$ExistingVersion\s*==\s*""/.test(detector)
  ) {
    return 'DetectExistingInstall must reject every incomplete or foreign NSIS registry record'
  }

  const semverValidation = detector.indexOf(
    'nsis_tauri_utils::SemverCompare $ExistingVersion "0.0.0-0"',
  )
  const semverComparison = detector.indexOf(
    'nsis_tauri_utils::SemverCompare "${VERSION}" $ExistingVersion',
  )
  if (
    semverValidation < 0 ||
    semverComparison < 0 ||
    semverValidation >= semverComparison ||
    !/SemverCompare \$ExistingVersion "0\.0\.0-0"[\s\S]*?Pop \$R0[\s\S]*?\$\{If\} \$R0 = -1[\s\S]*?Goto invalid_existing_version/.test(
      detector,
    )
  ) {
    return 'DetectExistingInstall must reject malformed SemVer before version ordering'
  }

  const automatic =
    detector.match(/automatic_update:([\s\S]*?)downgrade_blocked:/)?.[1] ?? ''
  if (
    !/StrCpy\s+\$UpdateMode\s+1/.test(automatic) ||
    !/StrCpy\s+\$PassiveMode\s+1/.test(automatic) ||
    !/StrCpy\s+\$ConfirmedExistingInstall\s+1/.test(automatic) ||
    !/\bReturn\b/.test(automatic)
  ) {
    return 'supported upgrades must set authoritative update, passive, and existing-install flags'
  }
  if (/\b(?:Exec|ExecWait|nsExec::)/.test(detector)) {
    return 'existing-install detection must not launch an old uninstaller automatically'
  }
  const sourceWithoutDetector = text.replace(
    /Function DetectExistingInstall\b[\s\S]*?FunctionEnd/,
    '',
  )
  if (/ReadRegStr[^\r\n]*"UninstallString"/.test(sourceWithoutDetector)) {
    return 'UninstallString must not be read outside non-executable install detection'
  }
  if (
    /reinst_uninstall/.test(text) ||
    /(?:Exec|ExecWait|nsExec::)[^\r\n]*\$ExistingUninstallCommand/.test(text)
  ) {
    return 'the install path must not execute a registry-derived old uninstaller'
  }

  for (const [label, nextLabel] of [
    ['downgrade_blocked', 'invalid_existing_version'],
    ['invalid_existing_version', 'legacy_wix_blocked'],
    ['legacy_wix_blocked', 'no_existing_install'],
  ]) {
    const block = detector.match(
      new RegExp(`${label}:([\\s\\S]*?)${nextLabel}:`),
    )?.[1]
    if (
      !block ||
      !/SetErrorLevel\s+(?!0\b)\d+/.test(block) ||
      !/\bQuit\b/.test(block)
    ) {
      return `${label} must set a nonzero exit code and terminate the installer`
    }
    if (/\bAbort\b/.test(block)) {
      return `${label} must not use Abort, which can only skip a custom page`
    }
  }

  const noExisting = detector.match(/no_existing_install:([\s\S]*)/)?.[1] ?? ''
  if (
    !/FileExists[\s\S]*MAINBINARYNAME/.test(noExisting) ||
    !/\bReturn\b/.test(noExisting)
  ) {
    return 'a registry-less existing binary must block instead of being treated as a clean install'
  }

  const installSection =
    text.match(/Section Install\b([\s\S]*?)SectionEnd/)?.[1] ?? ''
  if (/\$APPDATA/i.test(installSection)) {
    return 'the install/upgrade section must not delete Tono application data'
  }
  const installMacroNames = [
    ...installSection.matchAll(/!insertmacro\s+([A-Za-z0-9_.]+)/g),
  ].map((match) => match[1])
  for (const name of installMacroNames) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const body = text.match(
      new RegExp(`!macro\\s+${escapedName}\\b([\\s\\S]*?)!macroend`),
    )?.[1]
    if (body && /\$APPDATA/i.test(body)) {
      return `install macro ${name} must not mutate Tono application data`
    }
  }
  if (
    !/!insertmacro\s+RemoveVergeService[\s\S]*!insertmacro\s+StartVergeService[\s\S]*!insertmacro\s+RemoveKnownLegacyPayload/.test(
      installSection,
    )
  ) {
    return 'Service replacement must complete before legacy payload cleanup'
  }

  const removeServiceMacro =
    text.match(/!macro RemoveVergeService\b([\s\S]*?)!macroend/)?.[1] ?? ''
  const updatePreservationBranch = removeServiceMacro.match(
    /\$\{If\}\s+\$ConfirmedExistingInstall\s*==\s*1([\s\S]*?)\$\{Else\}/,
  )?.[1]
  if (
    !updatePreservationBranch ||
    /tono-service-uninstall|emergency-disarm|nsExec::/.test(
      updatePreservationBranch,
    )
  ) {
    return 'RemoveVergeService must preserve the Service and WFP state only for a confirmed existing install'
  }
  if (/\$\{If\}\s+\$UpdateMode\s*==\s*1/.test(removeServiceMacro)) {
    return 'raw /UPDATE mode must not authorize Service preservation'
  }

  const mainPayloadLines = installSection
    .split(/\r?\n/)
    .filter((line) => line.includes('MAINBINARYSRCPATH'))
  const stagedMainPayload =
    'File /a "/oname=${MAINBINARYNAME}.exe.next" "${MAINBINARYSRCPATH}"'
  if (
    mainPayloadLines.length !== 1 ||
    mainPayloadLines[0].trim() !== stagedMainPayload
  ) {
    return 'the main GUI payload must be extracted exactly once under the non-live .exe.next name'
  }
  const mainPayloadAt = installSection.indexOf(stagedMainPayload)
  if (
    !/\$\{If\}\s+\$ConfirmedExistingInstall\s*<>\s*1[\s\S]*?Rename\s+"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe\.next"\s+"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/.test(
      installSection.slice(mainPayloadAt),
    )
  ) {
    return 'only a clean install may publish the staged GUI before the coordinated helper runs'
  }
  for (const suffix of ['next', 'rollback', 'restore', 'publish']) {
    if (
      !text.includes(
        `Delete /REBOOTOK "$INSTDIR\\\${MAINBINARYNAME}.exe.${suffix}"`,
      )
    ) {
      return `installer.nsi does not clean the GUI replacement artifact: ${suffix}`
    }
  }

  const externalLoop =
    installSection.match(
      /; Stage external binaries[\s\S]*?\{\{#each binaries\}\}([\s\S]*?)\{\{\/each\}\}/,
    )?.[1] ?? ''
  if (!/File \/a "\/oname=\{\{this\}\}\.next"/.test(externalLoop)) {
    return 'confirmed repairs must extract external binaries under a non-live .next name'
  }
  if (/File \/a "\/oname=\{\{this\}\}"/.test(externalLoop)) {
    return 'the NSIS File instruction must never overwrite a live external binary'
  }
  if (
    !/\$\{If\}\s+\$ConfirmedExistingInstall\s*<>\s*1[\s\S]*?Rename\s+"\$INSTDIR\\\\\{\{this\}\}\.next"\s+"\$INSTDIR\\\\\{\{this\}\}"/.test(
      externalLoop,
    )
  ) {
    return 'only a clean install may rename staged Mihomo directly to its live path'
  }
  const stagedAt = installSection.indexOf('File /a "/oname={{this}}.next"')
  const helperAt = installSection.indexOf('!insertmacro StartVergeService')
  if (
    mainPayloadAt < 0 ||
    stagedAt < 0 ||
    helperAt < 0 ||
    mainPayloadAt >= helperAt ||
    stagedAt >= helperAt
  ) {
    return 'the GUI and Mihomo must both be staged before the Service replacement helper runs'
  }

  const startServiceMacro =
    text.match(/!macro StartVergeService\b([\s\S]*?)!macroend/)?.[1] ?? ''
  const confirmedHelperBranch =
    startServiceMacro.match(
      /\$\{If\}\s+\$ConfirmedExistingInstall\s*=\s*1([\s\S]*?)\$\{Else\}/,
    )?.[1] ?? ''
  if (
    !/tono-service-install\.exe" --replace-runtime/.test(confirmedHelperBranch)
  ) {
    return 'confirmed repairs must delegate the staged runtime to --replace-runtime'
  }
  if (/\/TIMEOUT=/.test(confirmedHelperBranch)) {
    return 'NSIS must not terminate the coordinated runtime replacement helper on a timeout'
  }
  if (
    /tono-service-(?:uninstall|install)\.exe[^\r\n]*--replace-runtime/.test(
      text.replace(confirmedHelperBranch, ''),
    )
  ) {
    return '--replace-runtime must appear only in the confirmed existing-install helper branch'
  }

  const displayVersionWrites = [
    ...installSection.matchAll(
      /WriteRegStr[^\r\n]*\$\{UNINSTKEY\}[^\r\n]*"DisplayVersion"/g,
    ),
  ]
  if (displayVersionWrites.length !== 2) {
    return 'DisplayVersion must have separate fresh-install and post-transaction writes'
  }
  const postHelperVersionAt = installSection.indexOf(
    'WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"',
    helperAt,
  )
  if (postHelperVersionAt <= helperAt) {
    return 'confirmed upgrades must commit DisplayVersion only after Service/runtime readiness'
  }

  // Centralize process creation so a launch cannot be smuggled into Section Install or ahead of
  // the reboot/silent gates under a different helper name. Full-line comments are excluded: a
  // commented example is not an execution primitive.
  const executableLines = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*;/.test(line))
  const executableText = executableLines.join('\n')
  const guiLaunchLines = executableLines.filter(
    (line) =>
      /\$\{MAINBINARYNAME\}\.exe|(?:^|[\\/])Tono\.exe/i.test(line) &&
      /nsis_tauri_utils::RunAsUser|^\s*(?:Exec|ExecWait|ExecShell|nsExec::)/i.test(
        line,
      ),
  )
  const canonicalGuiLaunch =
    'nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" "$MainBinaryArgs"'
  if (
    guiLaunchLines.length !== 1 ||
    guiLaunchLines[0].trim() !== canonicalGuiLaunch
  ) {
    return 'all GUI process creation must use the single canonical RunMainBinary launcher'
  }
  const runMainBinary =
    executableText.match(
      /Function RunMainBinary\b([\s\S]*?)FunctionEnd/,
    )?.[1] ?? ''
  const launcherAt = runMainBinary.indexOf(canonicalGuiLaunch)
  const launcherRebootGateAt = runMainBinary.indexOf('IfRebootFlag')
  if (
    launcherAt < 0 ||
    launcherRebootGateAt < 0 ||
    launcherRebootGateAt >= launcherAt ||
    !/StrCpy\s+\$MainBinaryArgs\s+""/.test(runMainBinary.slice(launcherAt)) ||
    !/!define\s+MUI_FINISHPAGE_RUN_FUNCTION\s+RunMainBinary/.test(text)
  ) {
    return 'RunMainBinary must be reboot-gated, consume one argument variable, and remain the Finish-page launcher'
  }

  const onInstSuccessMatch = executableText.match(
    /Function \.onInstSuccess\b([\s\S]*?)FunctionEnd/,
  )
  const onInstSuccess = onInstSuccessMatch?.[1] ?? ''
  if (/Call\s+RunMainBinary/.test(installSection)) {
    return 'the install section must not force-launch fresh /P installs before .onInstSuccess classification'
  }
  const launcherCalls = onInstSuccess.match(/Call\s+RunMainBinary/g) ?? []
  const outsideOnInstSuccess = onInstSuccessMatch
    ? executableText.replace(onInstSuccessMatch[0], '')
    : executableText
  if (
    launcherCalls.length !== 2 ||
    /Call\s+RunMainBinary/.test(outsideOnInstSuccess)
  ) {
    return 'explicit RunMainBinary calls must exist only in the two guarded .onInstSuccess branches'
  }
  const confirmedRelaunch =
    /\$\{If\}\s+\$ConfirmedExistingInstall\s*=\s*1\s+\$\{IfNot\}\s+\$\{Silent\}\s+StrCpy\s+\$MainBinaryArgs\s+""\s+Call\s+RunMainBinary\s+\$\{EndIf\}\s+Return\s+\$\{EndIf\}/.test(
      onInstSuccess,
    )
  const firstLauncherCallAt = onInstSuccess.indexOf('Call RunMainBinary')
  const successRebootGateAt = onInstSuccess.indexOf('IfRebootFlag')
  if (
    !confirmedRelaunch ||
    successRebootGateAt < 0 ||
    successRebootGateAt >= firstLauncherCallAt
  ) {
    return 'successful non-silent confirmed upgrades must relaunch exactly once after the reboot gate'
  }
  if (
    /\$\{OrIf\}\s+\$\{Silent\}/.test(onInstSuccess) ||
    !/\$\{If\}\s+\$\{Silent\}\s+Return\s+\$\{EndIf\}\s+\$\{If\}\s+\$PassiveMode\s*=\s*1\s+\$\{GetOptions\}\s+\$CMDLINE\s+"\/R"\s+\$R0\s+\$\{IfNot\}\s+\$\{Errors\}\s+StrCpy\s+\$MainBinaryArgs\s+""\s+\$\{GetOptions\}\s+\$CMDLINE\s+"\/ARGS"\s+\$MainBinaryArgs\s+Call\s+RunMainBinary\s+\$\{EndIf\}\s+\$\{EndIf\}/.test(
      onInstSuccess,
    )
  ) {
    return 'silent /S installs, including /S /R, must return without launching the GUI'
  }

  const installFailure =
    text.match(/Function \.onInstFailed\b([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  const preservedFailure = installFailure.match(
    /\$\{If\}\s+\$ConfirmedExistingInstall\s*=\s*1([\s\S]*?)\$\{EndIf\}/,
  )?.[1]
  const uninstallOnFailure = installFailure.indexOf(
    'tono-service-uninstall.exe',
  )
  const preserveOnFailure = installFailure.indexOf(
    '${If} $ConfirmedExistingInstall = 1',
  )
  if (
    !preservedFailure ||
    !/\bReturn\b/.test(preservedFailure) ||
    preserveOnFailure < 0 ||
    uninstallOnFailure < 0 ||
    preserveOnFailure >= uninstallOnFailure
  ) {
    return 'failed confirmed upgrades must preserve the pre-existing Service and WFP state'
  }

  return null
}

/**
 * Keep the privileged helper and the NSIS staging contract in lockstep. A protocol-revision
 * upgrade is safe only when the stopped-Service transaction owns all three live executables:
 * Service, Mihomo, and the GUI. This source gate complements the helper's file-level unit tests;
 * it cannot replace an elevated failure-injection upgrade test on a Windows VM.
 *
 * @param {string} source service/src/bin/install_service.rs source
 * @returns {string | null}
 */
export function validateWindowsReplacementHelperSource(source) {
  // Normalize CRLF: Windows checkouts (local and the windows-2025 runner) hand us
  // \r\n, and the structural regexes below anchor on bare \n sequences.
  const text = String(source).replace(/\r\n/g, '\n')
  const candidateAt = text.indexOf(
    'let app = app_replacement_candidate(&runtime)?;',
  )
  const repairGateAt = text.indexOf(
    'let _gate = enter_repair_gate()?;',
    candidateAt,
  )
  if (candidateAt < 0 || repairGateAt <= candidateAt) {
    return 'the helper must validate the staged GUI before entering the privileged repair gate'
  }

  const dispatch = text.match(
    /if let Some\(\(runtime_candidate, app_candidate\)\)[\s\S]*?return replace_existing_service_and_runtime\(([\s\S]*?)\);/,
  )?.[1]
  if (!dispatch || !/runtime_candidate,\s*app_candidate,/.test(dispatch)) {
    return 'the replace-runtime dispatch must pass both Mihomo and GUI candidates into the transaction'
  }

  const transaction = text.match(
    /fn replace_existing_service_and_runtime\(([\s\S]*?)\n}\n\n\/\/\/ install and start the service/,
  )?.[1]
  if (!transaction) {
    return 'the coordinated Service replacement transaction is missing'
  }
  for (const snippet of [
    'app_candidate: InstalledBinaryCandidate',
    '&app_candidate.staged',
    '&app_candidate.target',
    'app_candidate.expected_digest',
    'app_replacement.publish()?;',
    'app_replacement.is_old()',
    'app_replacement.is_new()',
  ]) {
    if (!transaction.includes(snippet)) {
      return `the coordinated replacement helper omits GUI transaction step: ${snippet}`
    }
  }
  const appRollbackAttempts =
    transaction.match(/\("App", &mut app_replacement\)/g)?.length ?? 0
  if (appRollbackAttempts < 2) {
    return 'both old-generation rollback and new-generation convergence must include the GUI'
  }
  const appCleanupAttempts =
    transaction.match(/app_replacement\.cleanup\(\);/g)?.length ?? 0
  if (appCleanupAttempts < 2) {
    return 'both successful commit and successful rollback must clean GUI transaction artifacts'
  }

  const runtimePublishAt = transaction.indexOf(
    'runtime_replacement.publish()?;',
  )
  const servicePublishAt = transaction.indexOf(
    'service_replacement.publish()?;',
  )
  const appPublishAt = transaction.indexOf('app_replacement.publish()?;')
  const recoverySuppressedAt = transaction.indexOf(
    'suppress_windows_service_recovery(service)?;',
  )
  const serviceStartAt = transaction.indexOf(
    'service.start(&Vec::<&OsStr>::new())?;',
    servicePublishAt,
  )
  const readinessAt = transaction.indexOf(
    'wait_for_service_ready()?;',
    serviceStartAt,
  )
  const recoveryRestoredAt = transaction.indexOf(
    'configure_windows_service_recovery(service)?;',
    readinessAt,
  )
  if (
    recoverySuppressedAt < 0 ||
    runtimePublishAt < 0 ||
    servicePublishAt <= runtimePublishAt ||
    recoverySuppressedAt >= runtimePublishAt ||
    serviceStartAt <= servicePublishAt ||
    readinessAt <= serviceStartAt ||
    recoveryRestoredAt <= readinessAt ||
    appPublishAt <= recoveryRestoredAt
  ) {
    return 'the candidate Service must start with recovery suppressed, pass IPC readiness, restore recovery actions, and only then publish the GUI'
  }
  return null
}

/**
 * Reject feature unification that makes WebView JavaScript dispatch synchronous
 * in a production build. `tauri-plugin-devtools` enables Tauri's `tracing`
 * feature even when its runtime registration is behind `debug_assertions`.
 *
 * @param {string} featureTree output of `cargo tree -e features -i tauri-runtime-wry`
 * @returns {string | null}
 */
export function validateReleaseFeatureTree(featureTree) {
  const tree = String(featureTree)
  if (/tauri-runtime-wry feature "tracing"/.test(tree)) {
    return 'default release features enable tauri-runtime-wry/tracing; Windows WebView dispatch would become synchronous'
  }
  if (/tauri-plugin-devtools/.test(tree)) {
    return 'default release features include tauri-plugin-devtools; keep it optional behind tauri-dev'
  }
  return null
}

/**
 * Guard the release-critical HTTP clients against silently weakening TLS or
 * bypassing the DNS-pinned control-plane transport through an application-level
 * proxy. The inherited network helper is included because migrated scheduled
 * state can still reach compiled code even when its normal UI is hidden.
 *
 * @param {{ transport: string, webdav: string, mediaUnlock: string, legacyNetwork: string }} sources
 * @returns {string | null}
 */
export function validateTlsPolicySources(sources) {
  const transport = String(sources?.transport ?? '')
  const pinnedResolutionAt = transport.indexOf(
    '.resolve_to_addrs(bootstrap::API_HOST, &pinned)',
  )
  const directBuilderAt = transport.lastIndexOf(
    'reqwest::Client::builder()',
    pinnedResolutionAt,
  )
  const sharedBuilderAt = transport.lastIndexOf(
    'Self::builder()',
    pinnedResolutionAt,
  )

  // The transport may configure the pinned client directly, or it may use the
  // shared `Self::builder()` factory so the pinned and system-resolved fallback
  // clients cannot drift. Inspect the builder that actually feeds the pinned
  // resolution instead of assuming `.no_proxy()` must be textually adjacent to
  // `.resolve_to_addrs()`: the production transport deliberately uses the shared
  // factory, and the old adjacency check rejected that safe shape.
  let proxyFreePinnedBuilder = false
  if (pinnedResolutionAt >= 0 && directBuilderAt > sharedBuilderAt) {
    const noProxyAt = transport.indexOf('.no_proxy()', directBuilderAt)
    proxyFreePinnedBuilder =
      noProxyAt > directBuilderAt && noProxyAt < pinnedResolutionAt
  } else if (pinnedResolutionAt >= 0 && sharedBuilderAt >= 0) {
    const sharedBuilder = transport.match(
      /fn\s+builder\(\)\s*->\s*reqwest::ClientBuilder\s*\{([\s\S]*?)\n\s*\}/,
    )?.[1]
    if (sharedBuilder) {
      const baseBuilderAt = sharedBuilder.indexOf('reqwest::Client::builder()')
      const noProxyAt = sharedBuilder.indexOf('.no_proxy()', baseBuilderAt)
      proxyFreePinnedBuilder = baseBuilderAt >= 0 && noProxyAt > baseBuilderAt
    }
  }

  if (!proxyFreePinnedBuilder) {
    return 'Tono control-plane transport must disable application-level proxy discovery before applying its pinned resolver'
  }

  const forbidden =
    /\.danger_accept_invalid_(?:certs|hostnames)\s*\(\s*true\s*\)/
  for (const [label, source] of [
    ['Tono control-plane transport', transport],
    ['WebDAV client', String(sources?.webdav ?? '')],
    ['media unlock checker', String(sources?.mediaUnlock ?? '')],
    ['legacy network client', String(sources?.legacyNetwork ?? '')],
  ]) {
    if (forbidden.test(source)) {
      return `${label} disables TLS certificate or hostname verification`
    }
  }
  return null
}

/**
 * @param {unknown} externalBin
 * @returns {string | null} error message, or null when valid
 */
export function validateExternalBin(externalBin) {
  if (!Array.isArray(externalBin) || externalBin.length !== 1) {
    return `bundle.externalBin must be exactly one stable sidecar entry, got: ${JSON.stringify(externalBin)}`
  }
  if (externalBin.some((entry) => String(entry).includes('alpha'))) {
    return 'release config still bundles the unaudited alpha Mihomo sidecar'
  }
  if (externalBin[0] !== STABLE_EXTERNAL_BIN) {
    return `bundle.externalBin[0] must be "${STABLE_EXTERNAL_BIN}", got: ${externalBin[0]}`
  }
  return null
}

/**
 * @param {unknown} resources
 * @returns {string | null}
 */
export function validateResourcesWhitelist(resources) {
  if (!Array.isArray(resources)) {
    return 'bundle.resources must be an explicit array (Windows whitelist)'
  }
  if (
    resources.some((entry) => entry === 'resources' || entry === 'resources/')
  ) {
    return 'bundle.resources still packages the whole resources/ directory; use an explicit Windows file whitelist'
  }
  const expected = [...WINDOWS_RESOURCE_BUNDLE_ENTRIES].sort()
  const actual = [...resources].map(String).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return `bundle.resources whitelist mismatch.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
  }
  return null
}

/**
 * @param {{ name: string, base?: string }[]} entries
 * @returns {string | null}
 */
/**
 * Parse a 7-Zip bare listing (`7zz l -ba`) into payload entries.
 *
 * Real 7zz output for a Tauri NSIS installer leaves the date/time columns
 * blank for entries without stored timestamps and the compressed column
 * blank for members of the solid block — a parser that requires all six
 * columns reports an empty payload and fails the gate against a perfectly
 * good installer. Directories (attr `D…` or trailing `/`) are skipped.
 *
 * @param {string} listing raw stdout of `7zz l -ba <installer>`
 * @returns {{ name: string, base: string, size: number }[]}
 */
export function parseNsisListing(listing) {
  const entries = []
  for (const line of String(listing).split(/\r?\n/)) {
    const match = line.match(
      /^(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\s{19})\s+(\S+)\s+(\d+)(?:\s+(\d+))?\s+(.+)$/,
    )
    if (!match) continue
    const [, attr, size, , rawName] = match
    if (attr.toUpperCase().includes('D')) continue
    const name = rawName.trim().replaceAll('\\', '/')
    if (!name || name.endsWith('/')) continue
    entries.push({
      name,
      base: name.split('/').pop() || name,
      size: Number(size),
    })
  }
  return entries
}

export function validatePayloadEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'payload listing is empty'
  }

  const normalized = entries.map((entry) => {
    const name = String(entry.name || '').replaceAll('\\', '/')
    const base = entry.base || name.split('/').pop() || name
    return { name, base, size: entry.size ?? 0 }
  })

  const bases = normalized.map((entry) => entry.base)
  const alpha = bases.filter((base) => /verge-mihomo-alpha/i.test(base))
  if (alpha.length) {
    return `installer payload still contains alpha Mihomo: ${[...new Set(alpha)].join(', ')}`
  }

  // The custom NSIS transaction must be the only code that publishes the GUI
  // and Mihomo. Their archive members therefore stay under non-live `.next`
  // names even for a fresh install (the fresh path renames them after extraction).
  // Accepting the old live names here would let a generated File instruction
  // overwrite an executable before the coordinated upgrade helper is ready.
  const stagedGui = bases.filter((base) => /^Tono\.exe\.next$/i.test(base))
  if (stagedGui.length !== 1) {
    return `installer payload must contain exactly one staged GUI basename Tono.exe.next, found ${stagedGui.length}`
  }
  const unexpectedGui = bases.filter(
    (base) =>
      /^Tono\.exe(?:\..*)?$/i.test(base) && !/^Tono\.exe\.next$/i.test(base),
  )
  if (unexpectedGui.length) {
    return `installer payload must not contain a live or repair GUI basename: ${[...new Set(unexpectedGui)].join(', ')}`
  }

  const stagedMihomo = bases.filter((base) =>
    /^verge-mihomo\.exe\.next$/i.test(base),
  )
  if (stagedMihomo.length !== 1) {
    return `installer payload is missing stable Mihomo staging contract (expected exactly one verge-mihomo.exe.next, found ${stagedMihomo.length})`
  }
  const unexpectedMihomo = bases.filter(
    (base) =>
      /^verge-mihomo/i.test(base) && !/^verge-mihomo\.exe\.next$/i.test(base),
  )
  if (unexpectedMihomo.length) {
    return `installer payload must not contain a live, repair, or alternate stable Mihomo basename: ${[...new Set(unexpectedMihomo)].join(', ')}`
  }

  const forbidden = normalized.filter((entry) =>
    FORBIDDEN_PAYLOAD_NAME_PATTERNS.some(
      (pattern) => pattern.test(entry.base) || pattern.test(entry.name),
    ),
  )
  if (forbidden.length) {
    return `installer payload contains forbidden Windows junk: ${forbidden
      .map((entry) => entry.name)
      .join(', ')}`
  }

  for (const required of [
    'tono-service.exe',
    'tono-service-install.exe',
    'tono-service-uninstall.exe',
    'core-sha256.txt',
  ]) {
    if (!bases.some((base) => base.toLowerCase() === required.toLowerCase())) {
      return `installer payload is missing required file basename: ${required}`
    }
  }

  return null
}

/**
 * Prove that a privileged Service binary carries the digest of the exact Core in the package.
 * Rust's `option_env!("TONO_CORE_SHA256")` embeds the lowercase ASCII digest in both the daemon
 * and replacement helper. An absent pin is deliberately a runtime refusal, so release packaging
 * must reject it here instead of asking a customer to discover it after installation.
 *
 * @param {Uint8Array} binaryBytes bytes of tono-service.exe or tono-service-install.exe
 * @param {string} coreDigest lowercase SHA-256 hex digest of the packaged Mihomo
 * @param {string} label binary name used in diagnostics
 * @returns {string | null}
 */
export function validateEmbeddedCoreDigestPin(
  binaryBytes,
  coreDigest,
  label = 'Service binary',
) {
  const normalized = String(coreDigest).trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return 'packaged Mihomo SHA-256 is missing or malformed'
  }
  const binary = Buffer.from(binaryBytes)
  const pin = Buffer.from(normalized, 'ascii')
  if (!binary.includes(pin)) {
    return `${label} does not embed the packaged Mihomo SHA-256 pin ${normalized}`
  }
  return null
}

/**
 * Pick only allowlisted files from a built release resources directory.
 * @param {string[]} basenames on-disk names under releaseDir/resources
 * @returns {{ allowed: string[], rejected: string[] }}
 */
export function partitionReleaseResources(basenames) {
  const allowed = []
  const rejected = []
  for (const name of basenames) {
    if (WINDOWS_RESOURCE_ALLOWLIST.includes(name)) {
      allowed.push(name)
    } else {
      rejected.push(name)
    }
  }
  return { allowed, rejected }
}
