Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

!addplugindir "$%AppData%\Local\NSIS\"

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define SHORTDESCRIPTION "{{short_description}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"
; One name for the emergency-disarm shortcut so creation and removal can never drift apart. The
; wording matches what `service.rs` tells the user to right-click when the disarm is refused.
!define RESTORENETWORKLINK "${PRODUCTNAME} — 恢复网络 (Restore Network).lnk"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var ExistingVersion
Var ExistingUninstallCommand
; Unlike `/UPDATE`, this is set only after a complete installed-product record passes version
; validation. It prevents failure cleanup from disarming a Service owned by the previous install.
Var ConfirmedExistingInstall
Var OldMainBinaryName
; The single GUI launcher consumes this value. Empty for Finish-page/repair launches; `/ARGS`
; populates it only for an explicit fresh passive `/R` request.
Var MainBinaryArgs
Var VC_REDIST_URL
Var VC_REDIST_EXE
Var VC_RUNTIME_READY
Var VC_RUNTIME_NEEDED
; Set once this run has handed control to the Service installer, so `.onInstFailed` only tears
; down a registration this install could have created and never an unrelated healthy Service.
Var ServiceInstallAttempted
Var ServiceInstallRetries

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${SHORTDESCRIPTION}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!if "${ADDITIONALPLUGINSPATH}" != ""
  !addplugindir "${ADDITIONALPLUGINSPATH}"
!endif

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
  !define MUI_UNICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP  "${HEADERIMAGE}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; Existing-install detector called from .onInit for interactive, passive and silent installs. A
; supported NSIS install is always upgraded/repaired in place: there is no ambiguous "uninstall
; first / do not uninstall" page. Update mode preserves AppData, shortcuts and the running
; fail-closed Service; passive mode closes the old GUI without another prompt.
Function DetectExistingInstall
  ; Prefer Tono's authoritative NSIS registry key. A stale legacy MSI record must never override
  ; a supported current install and trigger an unrelated migration path.
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayName"
  ReadRegStr $ExistingUninstallCommand SHCTX "${UNINSTKEY}" "UninstallString"
  ReadRegStr $ExistingVersion SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${If} "$R0$ExistingUninstallCommand$ExistingVersion" != ""
    ; Any evidence of this product-specific key must form one complete Tono record. Accepting a
    ; version-only or foreign partial key as an upgrade could overwrite files we did not identify.
    ${If} $R0 != "${PRODUCTNAME}"
    ${OrIf} $ExistingUninstallCommand == ""
    ${OrIf} $ExistingVersion == ""
      Goto invalid_existing_version
    ${EndIf}

    ; SemverCompare orders a parsed operand above an unparseable one, so comparing the new valid
    ; version directly with malformed existing text would look like an ordinary upgrade. Every
    ; valid SemVer is >= the minimum valid pre-release below; -1 therefore means parse failure.
    nsis_tauri_utils::SemverCompare $ExistingVersion "0.0.0-0"
    Pop $R0
    ${If} $R0 = -1
      Goto invalid_existing_version
    ${EndIf}

    nsis_tauri_utils::SemverCompare "${VERSION}" $ExistingVersion
    Pop $R0
    ${If} $R0 = 0
      Goto automatic_update
    ${ElseIf} $R0 = 1
      Goto automatic_update
    ${ElseIf} $R0 = -1
      !if "${ALLOWDOWNGRADES}" == "true"
        Goto automatic_update
      !else
        Goto downgrade_blocked
      !endif
    ${Else}
      Goto invalid_existing_version
    ${EndIf}
  ${EndIf}

  check_legacy_wix:
  ; Old WiX/MSI entries are UUID-keyed and the historical name/publisher heuristic is not strong
  ; enough to uninstall one unattended. Block with one instruction instead of deleting whichever
  ; product happened to match. No supported Tono NSIS install was found above.
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" no_existing_install
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $ExistingUninstallCommand HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $ExistingUninstallCommand "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 legacy_wix_blocked wix_loop

  automatic_update:
    StrCpy $UpdateMode 1
    StrCpy $PassiveMode 1
    StrCpy $ConfirmedExistingInstall 1
    DetailPrint "Automatically upgrading ${PRODUCTNAME} $ExistingVersion to ${VERSION}; preserving application data and Service state."
    Return

  downgrade_blocked:
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "$(downgradeBlocked)"
    ${EndIf}
    SetErrorLevel 1638
    Quit

  invalid_existing_version:
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "$(invalidExistingVersion)"
    ${EndIf}
    SetErrorLevel 1638
    Quit

  legacy_wix_blocked:
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "$(legacyWixManualMigration)"
    ${EndIf}
    SetErrorLevel 1638
    Quit

  no_existing_install:
    ; A program file without a valid installer record is an ambiguous partial/foreign install.
    ; Never overwrite it as though this were a clean machine.
    ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${OrIf} ${FileExists} "$INSTDIR\verge-mihomo.exe"
      Goto invalid_existing_version
    ${EndIf}
    Return
FunctionEnd

; 5. Start menu shortcut page. Tono's privileged core allowlist requires the per-machine
; Program Files location selected in .onInit, so do not offer an unsupported custom directory.
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 6. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 7. Finish page
;
; Don't auto jump to finish page after installation page,
; because the installation page has useful info that can be used debug any issues with the installer.
!define MUI_FINISHPAGE_NOAUTOCLOSE
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function RunMainBinary
  IfRebootFlag skipRunMainBinary runMainBinaryNow
  skipRunMainBinary:
    DetailPrint "A reboot is required before ${PRODUCTNAME} can start with the updated Service."
    Return
  runMainBinaryNow:
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$MainBinaryArgs"
  StrCpy $MainBinaryArgs ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

LangString legacyLocationAbort ${LANG_SIMPCHINESE} "检测到 ${PRODUCTNAME} 安装在不受支持的位置：$4$\r$\n$\r$\n此版本必须安装在 Program Files 中。请先卸载现有版本（不要勾选删除应用数据），然后重新运行此安装程序。"
LangString legacyLocationAbort ${LANG_ENGLISH} "${PRODUCTNAME} is installed in an unsupported location: $4$\r$\n$\r$\nThis version must be installed under Program Files. Uninstall the existing version first (do not select Delete application data), then run this installer again."
LangString legacyLocationAbort ${LANG_RUSSIAN} "${PRODUCTNAME} установлен в неподдерживаемой папке: $4$\r$\n$\r$\nЭта версия должна быть установлена в Program Files. Сначала удалите текущую версию (не выбирайте удаление данных приложения), затем снова запустите этот установщик."

LangString downgradeBlocked ${LANG_SIMPCHINESE} "检测到较新的 ${PRODUCTNAME} 版本（$ExistingVersion）。为了保护应用数据和系统服务，安装已停止。请使用较新版本的安装程序。"
LangString downgradeBlocked ${LANG_ENGLISH} "A newer ${PRODUCTNAME} version ($ExistingVersion) is installed. Setup stopped to protect application data and the system Service. Use an installer for that version or newer."
LangString downgradeBlocked ${LANG_RUSSIAN} "Установлена более новая версия ${PRODUCTNAME} ($ExistingVersion). Установка остановлена для защиты данных приложения и системной службы. Используйте установщик этой или более новой версии."

LangString invalidExistingVersion ${LANG_SIMPCHINESE} "检测到现有 ${PRODUCTNAME} 安装，但无法安全确认其版本。安装已停止，未删除应用数据。请先修复或卸载现有版本（不要选择删除应用数据），再重试。"
LangString invalidExistingVersion ${LANG_ENGLISH} "An existing ${PRODUCTNAME} installation was found, but its version could not be verified safely. Setup stopped without deleting application data. Repair or uninstall the existing version (do not select Delete application data), then retry."
LangString invalidExistingVersion ${LANG_RUSSIAN} "Обнаружена существующая установка ${PRODUCTNAME}, но её версию не удалось безопасно проверить. Установка остановлена без удаления данных приложения. Восстановите или удалите текущую версию (не выбирая удаление данных приложения), затем повторите попытку."

LangString legacyWixManualMigration ${LANG_SIMPCHINESE} "检测到旧版 MSI/WiX ${PRODUCTNAME}。为了避免误删应用数据，此安装程序不会自动卸载它。请从 Windows“已安装的应用”中卸载旧版（不要删除应用数据），然后重新运行此安装程序。"
LangString legacyWixManualMigration ${LANG_ENGLISH} "A legacy MSI/WiX ${PRODUCTNAME} installation was found. To avoid deleting application data accidentally, this installer will not remove it automatically. Uninstall the legacy version from Windows Installed apps without deleting application data, then run this installer again."
LangString legacyWixManualMigration ${LANG_RUSSIAN} "Обнаружена устаревшая MSI/WiX-установка ${PRODUCTNAME}. Во избежание случайного удаления данных этот установщик не будет удалять её автоматически. Удалите старую версию через список установленных приложений Windows без удаления данных приложения, затем снова запустите этот установщик."

LangString restoreNetworkTooltip ${LANG_SIMPCHINESE} "当 ${PRODUCTNAME} 无法恢复网络时，解除网络保护（需要管理员权限）。"
LangString restoreNetworkTooltip ${LANG_ENGLISH} "Restores your network if ${PRODUCTNAME} cannot. Requires administrator approval."
LangString restoreNetworkTooltip ${LANG_RUSSIAN} "Восстанавливает сеть, если ${PRODUCTNAME} не может. Требуются права администратора."

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    ; Auto-update forwards the app's UI language as `/LANG=<NSIS-lang-id>` so
    ; the installer uses it directly and skips the interactive language
    ; selector, letting the update start without prompting the user.
    ; See `src-tauri/src/core/updater.rs` (`nsis_language_id`).
    ${GetOptions} $CMDLINE "/LANG=" $0
    ${IfNot} ${Errors}
      ${If} $0 == "1033"
      ${OrIf} $0 == "1049"
      ${OrIf} $0 == "2052"
        StrCpy $LANGUAGE $0
      ${Else}
        !insertmacro MUI_LANGDLL_DISPLAY
      ${EndIf}
    ${Else}
      !insertmacro MUI_LANGDLL_DISPLAY
    ${EndIf}
  !endif

  !insertmacro SetContext

  !if "${INSTALLMODE}" == "perMachine"
    ; The privileged Service only trusts its core under Program Files. Force the supported
    ; location even when /D= is passed, which bypasses NSIS's directory page handling.
    ${If} ${RunningX64}
      !if "${ARCH}" == "x64"
        StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
      !else if "${ARCH}" == "arm64"
        StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
      !else
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      !endif
    ${Else}
      StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
    ${EndIf}

    ; Refuse to layer a second copy over a legacy custom-location install. Automatic migration
    ; would leave its shortcuts and scheduled-task autostart pointing at the old executable.
    ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
    ${If} $4 != ""
    ${AndIf} $4 != $INSTDIR
      ${IfNot} ${Silent}
        MessageBox MB_ICONSTOP "$(legacyLocationAbort)"
      ${EndIf}
      SetErrorLevel 5
      Abort
    ${EndIf}
  !else
    ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
      !if "${INSTALLMODE}" == "currentUser"
        StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
      !endif
      Call RestorePreviousInstallLocation
    ${EndIf}
  !endif


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif

  ; Classify an existing installation here rather than in a page callback so silent installs and
  ; updater launches follow exactly the same fail-closed version checks as interactive installs.
  Call DetectExistingInstall
FunctionEnd


Function CheckVCRuntime64
  Push $R0
  Push $R1
  StrCpy $VC_RUNTIME_READY "0"
  ; A 32-bit installer only reaches the native system directory through the Sysnative alias;
  ; where that alias does not exist, System32 already is the native one. Use labels: the former
  ; `+3` counted onto `Goto found` and both declared the runtime present without probing it and
  ; made the System32 fallback unreachable.
  StrCpy $R1 "$WINDIR\Sysnative"
  IfFileExists "$R1\kernel32.dll" probe 0
  StrCpy $R1 "$WINDIR\System32"
  probe:
  IfFileExists "$R1\vcruntime140.dll" 0 missing
  IfFileExists "$R1\msvcp140.dll" 0 missing
  found:
    StrCpy $VC_RUNTIME_READY "1"
    Goto done
  missing:
    StrCpy $VC_RUNTIME_READY "0"
  done:
    Pop $R1
    Pop $R0
FunctionEnd


!macro StartVergeService
  ; The per-machine installer is already elevated, so create/repair the Service here instead
  ; of forcing the first Connect through a second UAC prompt. The helper also waits for the
  ; Service IPC protocol to become ready before it returns success.
  ${IfNot} ${FileExists} "$INSTDIR\resources\tono-service-install.exe"
    Abort "Tono Service installer is missing. Installation cannot continue safely."
  ${EndIf}
  DetailPrint "Installing and verifying ${PRODUCTNAME} Service..."
  ; Arm `.onInstFailed` for exactly this step: from here until the helper returns, a Service may
  ; exist that this run registered but never proved ready. Cleared again on the way out — once a
  ; verified Service is running, a later failure must leave it alone and let uninstall.exe (already
  ; written above) be the removal path, rather than silently opening the user's network.
  StrCpy $ServiceInstallAttempted 1
  StrCpy $ServiceInstallRetries 0
  serviceInstallAttempt:
  ${If} $ConfirmedExistingInstall = 1
    ; The helper owns a short three-executable transaction: it stops the Service only after Mihomo
    ; and the GUI are staged, verifies the new Service + core before publishing the GUI, and restores
    ; all three before returning any failure. Never give nsExec a TerminateProcess timeout here—killing Rust during
    ; rollback would strand the stopped Service. Every SCM and IPC wait inside the helper is bounded.
    nsExec::ExecToLog '"$INSTDIR\resources\tono-service-install.exe" --replace-runtime'
  ${Else}
    ; Fresh-install Service repair does not own a live runtime transaction, so retain the outer
    ; inactivity bound in addition to the helper's own SCM/IPC waits.
    nsExec::ExecToLog /TIMEOUT=180000 '"$INSTDIR\resources\tono-service-install.exe"'
  ${EndIf}
  Pop $0
  ; nsExec returns a string: "error" and "timeout" must not be coerced to integer zero.
  ${If} $0 == "3010"
    DetailPrint "${PRODUCTNAME} Service update will finish after a reboot."
    SetRebootFlag true
  ${ElseIf} $0 == "75"
    ; 75 = REPAIR_IN_PROGRESS_EXIT_CODE (service/src/core/repair.rs): another elevated repair
    ; holds the gate. That is transient and retryable, so it must not dead-end a whole install.
    ${If} $ServiceInstallRetries < 5
      IntOp $ServiceInstallRetries $ServiceInstallRetries + 1
      DetailPrint "Another ${PRODUCTNAME} Service repair is in progress; retrying ($ServiceInstallRetries/5)..."
      Sleep 2000
      Goto serviceInstallAttempt
    ${EndIf}
    Abort "A ${PRODUCTNAME} Service repair is still in progress. Wait for it to finish (or reboot Windows), then run this installer again."
  ${ElseIf} $0 != "0"
    ; A generic helper failure during an upgrade is most often a transient lock held by the
    ; running Service/core (file-in-use, SCM stop race, IPC readiness window) — customers hit
    ; "second click works", so the installer now does that second click itself. The helper is
    ; transactional (stages before replacing, rolls back on failure), so retrying it is safe.
    ${If} $ServiceInstallRetries < 3
      IntOp $ServiceInstallRetries $ServiceInstallRetries + 1
      DetailPrint "Service installation returned exit $0; retrying ($ServiceInstallRetries/3)..."
      Sleep 5000
      Goto serviceInstallAttempt
    ${EndIf}
    Abort "Tono Service installation failed (exit $0). Installation was stopped."
  ${EndIf}
  ; Only reachable when the helper reported success (every other path Aborts): the Service is
  ; registered and verified, so it is no longer this install's to tear down.
  StrCpy $ServiceInstallAttempted 0
!macroend

!macro RemoveVergeService
  ; An updater temporarily removes the old application files but must preserve the running
  ; Service until the new install helper replaces it. The helper itself distinguishes a durable
  ; active/wanted session (preserve fail-closed) from a disconnected old build (write a one-start
  ; wanted:false tombstone so late-visible orphan filters are cleaned by the replacement).
  ${If} $ConfirmedExistingInstall == 1
    DetailPrint "Update mode: preserving ${PRODUCTNAME} Service until replacement."
  ${Else}
    ; The dedicated helper restores protected DNS, removes persistent WFP objects, then deletes
    ; the SCM registration. Never delete its recovery binaries after a failed or unverifiable
    ; cleanup. A damaged install must be repaired first rather than fail open here.
    ;
    ; What "unverifiable" means changed, and the reason is worth keeping: this macro used to
    ; abort unless the user's exact prior DNS configuration was provably restored. On a machine
    ; whose live DNS apply keeps failing that proof never arrives, so the abort fired every time
    ; and Tono could not be uninstalled at all. The helper now escalates instead (exact restore →
    ; automatic/DHCP → refuse), and the only thing that still blocks here is "the kill-switch
    ; filters may still be installed" — because removing the app while a persistent WFP barrier
    ; stays armed leaves a blocked machine with no software left to unblock it. An inexact
    ; resolver does not: the user can change DNS from Windows' own network settings.
    ${IfNot} ${FileExists} "$INSTDIR\resources\tono-service-uninstall.exe"
      Abort "Tono Service uninstaller is missing. Reinstall Tono, then uninstall again."
    ${EndIf}
    DetailPrint "Restoring network protection and removing ${PRODUCTNAME} Service..."
    ; Preserve the recovery files but return control instead of hanging forever if cleanup stalls.
    nsExec::ExecToLog /TIMEOUT=180000 '"$INSTDIR\resources\tono-service-uninstall.exe"'
    Pop $0
    ; Second chance for machines that fail the first pass (stuck owner lock, ProgramData ACL, or
    ; a wedged first disarm): run the Service binary's emergency disarm, then retry the helper.
    ; Exit codes 0/2/4 already mean safe to continue — do not re-run them.
    ${If} $0 != "0"
    ${AndIf} $0 != "2"
    ${AndIf} $0 != "4"
      DetailPrint "First cleanup returned $0; trying emergency disarm and a second cleanup pass..."
      ${If} ${FileExists} "$INSTDIR\resources\tono-service.exe"
        nsExec::ExecToLog /TIMEOUT=120000 '"$INSTDIR\resources\tono-service.exe" --emergency-disarm'
        Pop $1
        DetailPrint "Emergency disarm finished (result $1)."
      ${EndIf}
      nsExec::ExecToLog /TIMEOUT=180000 '"$INSTDIR\resources\tono-service-uninstall.exe"'
      Pop $0
      DetailPrint "Second cleanup finished (result $0)."
    ${EndIf}
    ; The helper's exit-code contract (uninstall_service.rs `cleanup_exit_code`):
    ;   0 = the machine is clean (or was already clean)
    ;   2 = the network was provably restored; only cosmetic cleanup (SCM record/binary) failed
    ;   4 = the kill-switch filters were removed; DNS may be inexact (DHCP fallback, still on a
    ;       Tono resolver, or unproven). Continue — an inexact resolver is not a blocked machine.
    ;   3 = cleanup could not show the WFP barrier was removed; recovery files stay on disk
    ; nsExec may also return "error"/"timeout" or another numeric string. Only a proven-safe
    ; result may let the uninstall continue: anything that is not 0, 2 or 4 is treated exactly
    ; like 3, because nothing showed the machine was made safe. That discipline is unchanged —
    ; unknown results still block, and every blocking path still preserves the recovery files.
    ${If} $0 == "2"
      DetailPrint "${PRODUCTNAME} network protection was restored; some Service leftovers could not be removed and will be cleaned up by a future install."
    ${ElseIf} $0 == "4"
      DetailPrint "${PRODUCTNAME} network protection (kill switch) was removed. DNS may need a manual check: Settings > Network & Internet > your adapter > DNS server assignment > Automatic (DHCP) for IPv4 and IPv6. Install/uninstall continues because the machine is no longer blocked."
    ${ElseIf} $0 != "0"
      ; Result 3 means the kill-switch filters may still be installed. DNS-only problems no longer
      ; land here (they are exit 4). Reboot and retry, or reinstall to repair the Service first.
      Abort "Tono could not confirm this machine was made safe to uninstall (result $0), so nothing was deleted and the recovery files were kept. See the messages above for what failed. The kill switch may still be installed — reboot Windows and run this uninstaller or installer again. Removing Tono while the barrier stays armed would leave the machine blocked with nothing left to unblock it. Installing Tono again first also repairs the Service."
    ${EndIf}
  ${EndIf}
!macroend

; Test 5 and older installers copied a second Mihomo plus Unix-named service helpers/scripts into
; Program Files. They are intentionally absent from the current resource manifest, which also
; means Tauri's generated uninstall loop cannot know they exist. Remove the exact historical
; names on both upgrade and uninstall; /REBOOTOK covers an old core image that Windows still has
; mapped without broadening the target beyond Tono's own install directory.
!macro RemoveKnownLegacyPayload
  Delete /REBOOTOK "$INSTDIR\verge-mihomo-alpha.exe"
  ; A completed transaction removes these itself. Exact cleanup here covers a pre-publication
  ; installer abort and uninstall; a failed helper never reaches this macro, so recovery evidence
  ; from an unsuccessful rollback is deliberately preserved.
  Delete /REBOOTOK "$INSTDIR\verge-mihomo.exe.next"
  Delete /REBOOTOK "$INSTDIR\verge-mihomo.exe.rollback"
  Delete /REBOOTOK "$INSTDIR\verge-mihomo.exe.restore"
  Delete /REBOOTOK "$INSTDIR\verge-mihomo.exe.publish"
  Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.next"
  Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.rollback"
  Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.restore"
  Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.publish"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service-install"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service-uninstall"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service.exe"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service-install.exe"
  Delete /REBOOTOK "$INSTDIR\resources\clash-verge-service-uninstall.exe"
  Delete /REBOOTOK "$INSTDIR\resources\set_dns.sh"
  Delete /REBOOTOK "$INSTDIR\resources\unset_dns.sh"
!macroend

Section CheckAndInstallVSRuntime
  StrCpy $VC_RUNTIME_NEEDED "0"

  ${If} ${IsNativeARM64}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.arm64.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.arm64.exe"
    Call CheckVCRuntime64
    ${If} $VC_RUNTIME_READY != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}

  ${ElseIf} ${RunningX64}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.x64.exe"
    Call CheckVCRuntime64
    ${If} $VC_RUNTIME_READY != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}

  ${Else}
    StrCpy $VC_REDIST_URL "https://aka.ms/vs/17/release/vc_redist.x86.exe"
    StrCpy $VC_REDIST_EXE "vc_redist.x86.exe"

    IfFileExists "$SYSDIR\vcruntime140.dll" 0 filesMissing32
    IfFileExists "$SYSDIR\msvcp140.dll" 0 filesMissing32
    Goto afterFileCheck32
  filesMissing32:
    StrCpy $VC_RUNTIME_NEEDED "1"
  afterFileCheck32:
  ${EndIf}

  ${If} $VC_RUNTIME_NEEDED != "1"
    ; These probes need the native view, but they must hand the installer's own view back when
    ; they are done: `.onInit`'s SetContext selected view 64 for this build, and every later
    ; section (WebView2's literal WOW6432Node paths, the uninstall/ARP keys) is written for it.
    ; Leaving view 32 behind double-redirects those reads into keys that can never exist.
    ${If} ${IsNativeARM64}
      SetRegView 64
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
      !insertmacro SetContext
    ${ElseIf} ${RunningX64}
      SetRegView 64
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\${ARCH}" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
      !insertmacro SetContext
    ${Else}
      ClearErrors
      ReadRegDword $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86" "Installed"
      ${If} ${Errors}
        StrCpy $R0 0
      ${EndIf}
    ${EndIf}

    ${If} $R0 != "1"
      StrCpy $VC_RUNTIME_NEEDED "1"
    ${EndIf}
  ${EndIf}

  ${If} $VC_RUNTIME_NEEDED != "1"
    DetailPrint "已检测到匹配的 Visual C++ Redistributable，跳过安装"
    Goto done_vc
  ${EndIf}

  DetailPrint "正在下载 Visual C++ Redistributable..."
  nsisdl::download "$VC_REDIST_URL" "$TEMP\$VC_REDIST_EXE"
  Pop $0
  ${If} $0 == "success"
    DetailPrint "正在安装 Visual C++ Redistributable..."
    ExecWait '"$TEMP\$VC_REDIST_EXE" /quiet /norestart' $0
    ${If} $0 == 0
      DetailPrint "Visual C++ Redistributable 安装成功"
    ${ElseIf} $0 == 3010
      ; 3010 is "installed, reboot required" — a success the old branch logged as a failure.
      DetailPrint "Visual C++ Redistributable 安装成功，需要重启后生效"
      SetRebootFlag true
    ${ElseIf} $0 == 1638
      ; 1638 means a same-or-newer runtime is already registered; nothing to install.
      DetailPrint "已安装同版本或更新的 Visual C++ Redistributable，跳过安装"
    ${Else}
      DetailPrint "Visual C++ Redistributable 安装失败"
    ${EndIf}
    Delete "$TEMP\$VC_REDIST_EXE"
  ${Else}
    DetailPrint "Visual C++ Redistributable 下载失败"
  ${EndIf}

  done_vc:
SectionEnd

Section WebView2
  ; The literal WOW6432Node paths below are only correct in the native register view this build
  ; installs under. Re-assert it rather than inheriting whatever an earlier section left set: a
  ; misdetected WebView2 sends an offline install into the bootstrapper and Aborts it.
  !insertmacro SetContext

  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer; quote it, $TEMP routinely has a space.
        ExecWait '"$6" ${WEBVIEW2INSTALLERARGS} /install' $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Ensure startup folders exist. `$SMSTARTUP` follows the shell context and the machine's real
  ; ProgramData location, which a hardcoded English C:-rooted path does not.
  SetShellVarContext all
  CreateDirectory "$SMSTARTUP"
  DetailPrint "Ensured system startup folder exists: $SMSTARTUP"

  SetShellVarContext current
  StrCpy $0 "$SMPROGRAMS\Startup"
  CreateDirectory "$0"
  DetailPrint "Ensured user startup folder exists: $0"

  !insertmacro SetContext

  ; A confirmed upgrade must not expose the new GUI until its matching Service and Mihomo are
  ; protocol-ready. The elevated helper owns all three replacements and restores all three on any
  ; failure. A clean install has no predecessor, so publish the staged GUI
  ; immediately before creating its recovery/uninstall path.
  File /a "/oname=${MAINBINARYNAME}.exe.next" "${MAINBINARYSRCPATH}"
  ${If} $ConfirmedExistingInstall <> 1
    ClearErrors
    Rename "$INSTDIR\${MAINBINARYNAME}.exe.next" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} ${Errors}
      Abort "Could not publish the staged Tono application. Installation stopped before creating the Service."
    ${EndIf}
  ${EndIf}

  ; Copy packaged repair payloads. These are sources for later elevated Service repair, not the
  ; live Service/core/App targets coordinated below; DisplayVersion still remains uncommitted until
  ; the live generation passes IPC readiness.
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Stage external binaries under a non-live name. A connected Service owns verge-mihomo.exe and
  ; Windows correctly refuses to overwrite that mapped image. Confirmed repairs leave `.next` for
  ; the Service helper's fail-closed three-executable transaction; a clean install has no live
  ; target and publishes it immediately with one same-volume rename. Packaging gates keep this
  ; loop to the single stable Mihomo binary until the helper explicitly supports another member.
  {{#each binaries}}
    File /a "/oname={{this}}.next" "{{no-escape @key}}"
    ${If} $ConfirmedExistingInstall <> 1
      ClearErrors
      Rename "$INSTDIR\\{{this}}.next" "$INSTDIR\\{{this}}"
      ${If} ${Errors}
        Abort "Could not publish the staged Tono runtime. Installation stopped before creating the Service."
      ${EndIf}
    ${EndIf}
  {{/each}}

  ; Register the removal path BEFORE the Service is created and started. NSIS rolls back neither
  ; `File` nor an SCM registration, and StartVergeService can Abort after create/start succeeded
  ; (a failed readiness wait). Writing uninstall.exe and the Add/Remove entry first is what keeps
  ; that failure from leaving an AutoStart Service arming the WFP floor with no way to remove it
  ; — on upgrades this refreshes the existing recovery path before the Service helper is replaced.
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  ; A failed upgrade can restore the old Service/core pair. Do not claim the new version in ARP
  ; until that transaction has committed; fresh installs still need their recovery entry before
  ; Service creation because NSIS does not roll SCM registrations back automatically.
  ${If} $ConfirmedExistingInstall <> 1
    WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  ${EndIf}
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; A fresh/repair install may follow an older uninstaller that deleted its SCM record and state
  ; file but accidentally left persistent WFP filters behind. Starting the new Service directly
  ; would interpret that orphaned combination as an intentional fail-closed state and take the
  ; customer offline until the App happened to release it. A non-update install runs the full
  ; disarm helper here. UpdateMode deliberately keeps the Service in place, then the replacement
  ; helper preserves active protection or marks a proven-disconnected legacy state for cleanup.
  !insertmacro RemoveVergeService
  !insertmacro StartVergeService

  ${If} $ConfirmedExistingInstall = 1
    WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  ${EndIf}

  ; The replacement Service is verified and no legacy core can still own these files.
  !insertmacro RemoveKnownLegacyPayload

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
    ; Refreshed on every install, including updates and /NS: this is the recovery control the
    ; Service points users at, not a convenience shortcut, and its target moves with $INSTDIR.
    Call CreateOrUpdateRestoreNetworkShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; Auto close this page for passive mode
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstFailed
  ; NSIS rolls back neither `File` nor an SCM registration, so a failed install can end with a
  ; Service that this run registered but never proved ready: AutoStart, with SCM restart actions,
  ; arming a persistent WFP floor. Undo that registration with the same helper the uninstaller
  ; uses. The flag narrows this to the Service step itself, so an abort before it (a cancelled or
  ; refused install) and a failure after it (a verified Service that is now the user's, removable
  ; through Add/Remove Programs) both stay the no-op they have to be.
  ${If} $ServiceInstallAttempted <> 1
    Return
  ${EndIf}
  ; The replacement helper has its own fail-closed restart guard for an existing Service. Running
  ; the uninstall helper here would instead delete that pre-existing Service and deliberately
  ; disarm WFP—the opposite of safe upgrade rollback. `/UPDATE` alone is not authoritative because
  ; callers can pass it on a fresh install; only the validated registry detector sets this flag.
  ${If} $ConfirmedExistingInstall = 1
    DetailPrint "Upgrade failed while replacing ${PRODUCTNAME} Service; preserving the existing Service and network-protection state. Reboot Windows if needed, then run this installer again."
    Return
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\resources\tono-service-uninstall.exe"
    DetailPrint "Installation failed and the Service uninstaller is missing; run uninstall.exe from Add/Remove Programs to remove the ${PRODUCTNAME} Service."
    Return
  ${EndIf}
  DetailPrint "Installation failed; removing the ${PRODUCTNAME} Service registered by this install..."
  nsExec::ExecToLog /TIMEOUT=180000 '"$INSTDIR\resources\tono-service-uninstall.exe"'
  Pop $0
  ; Same contract as RemoveVergeService. Nothing here may block or delete: uninstall.exe and the
  ; Add/Remove entry were written before the Service was touched, so an unproven cleanup still
  ; leaves the user a supported removal path instead of a dead end.
  ${If} $0 == "0"
    DetailPrint "${PRODUCTNAME} Service was removed and network protection was restored."
  ${ElseIf} $0 == "2"
    DetailPrint "${PRODUCTNAME} network protection was restored; some Service leftovers remain and will be cleaned up by a future install."
  ${ElseIf} $0 == "4"
    DetailPrint "${PRODUCTNAME} network protection was removed, but your previous DNS servers could not be verified, so the affected adapters were set back to automatic (DHCP)."
  ${Else}
    DetailPrint "${PRODUCTNAME} Service cleanup could not be verified (result $0); your connection may still be protected by the kill switch. Reboot Windows, then run this installer again or uninstall ${PRODUCTNAME} from Add/Remove Programs."
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ; Exit 3010 means the old Service is running and its replacement is queued for reboot. Do not
  ; launch a new app binary against that potentially incompatible protocol generation.
  IfRebootFlag skipPostInstallRun checkPostInstallRun
  skipPostInstallRun:
    Return
  checkPostInstallRun:
  ; A validated same-version repair/upgrade is passive and therefore has no Finish-page Run
  ; checkbox. After every install section (including Service/runtime readiness) has succeeded,
  ; reopen its GUI exactly once as the unelevated user. `/S` always retains no-launch semantics.
  ${If} $ConfirmedExistingInstall = 1
    ${IfNot} ${Silent}
      StrCpy $MainBinaryArgs ""
      Call RunMainBinary
    ${EndIf}
    Return
  ${EndIf}

  ; Silent deployment never launches, even when `/R` was supplied. A fresh passive install may
  ; still explicitly opt in with `/R`; an ordinary fresh interactive install keeps the Finish-page
  ; checkbox and never reaches this branch.
  ${If} ${Silent}
    Return
  ${EndIf}
  ${If} $PassiveMode = 1
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      StrCpy $MainBinaryArgs ""
      ${GetOptions} $CMDLINE "/ARGS" $MainBinaryArgs
      Call RunMainBinary
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro RemoveVergeService

  ; Remove cached window state files
  DetailPrint "Removing window-state.json / .window-state.json"
  SetShellVarContext current
  Delete "$APPDATA\com.raydocs.tono\window-state.json"
  Delete "$APPDATA\com.raydocs.tono\.window-state.json"

  !insertmacro SetContext

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; These files came from older bundles and therefore never appear in the generated lists above.
  !insertmacro RemoveKnownLegacyPayload

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  ; A known legacy core may have required /REBOOTOK above. Schedule the exact product root too so
  ; Windows can remove the now-empty directory after those mapped images are released.
  RMDir /REBOOTOK "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder

    ; The recovery shortcut targets powershell.exe, so IsShortcutTarget cannot recognise it.
    ; Delete it before the RMDir below, or the leftover keeps the start menu folder alive.
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${RESTORENETWORKLINK}"
    Delete "$SMPROGRAMS\${RESTORENETWORKLINK}"

    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}

  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Learned control-plane pins used to live in user AppData. They are no longer
  ; trusted; delete the leftover even when the user keeps the rest of AppData.
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    Delete /REBOOTOK "$APPDATA\${BUNDLEID}\tono\control-plane-pins.json"
    Delete /REBOOTOK "$LOCALAPPDATA\${BUNDLEID}\tono\control-plane-pins.json"
  ${EndIf}

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Preserve the user's shortcut choice during automatic upgrades.
  ${If} $UpdateMode = 1
  ${OrIf} $NoShortcutMode = 1
    Return
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

; The last way back onto the network when the App cannot release the WFP barrier. Today that
; escape is an elevated `tono-service.exe --emergency-disarm` — a path and a flag nobody knows,
; on a machine that by definition cannot look them up. A .lnk cannot request elevation by itself,
; so the shortcut runs PowerShell's `Start-Process -Verb RunAs`, which is what raises UAC, over
; `cmd /k`, which holds the window open long enough to read the bilingual result the disarm
; prints. It is user-initiated only, and grants no authority the Add/Remove uninstaller lacks.
Function CreateOrUpdateRestoreNetworkShortcut
  Push $R0
  Push $R1

  ; System32 is resolved by the (64-bit) shell that launches the .lnk; either PowerShell bitness
  ; runs `-Verb RunAs` identically, so WOW64 redirection of this string is harmless.
  StrCpy $R0 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ; `$\"` is how NSIS writes a quote; `\$\"` is the backslash-escaped quote CommandLineToArgvW
  ; needs so the install path — which always contains a space — survives inside -Command.
  StrCpy $R1 "-NoProfile -ExecutionPolicy Bypass -Command $\"Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','\$\"$INSTDIR\resources\tono-service.exe\$\" --emergency-disarm' -Verb RunAs$\""

  ; SW_SHOWMINIMIZED keeps the launcher window out of the way; the elevated console it starts is
  ; the one the user reads.
  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${RESTORENETWORKLINK}" "$R0" "$R1" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWMINIMIZED "" "$(restoreNetworkTooltip)"
  !else
    CreateShortcut "$SMPROGRAMS\${RESTORENETWORKLINK}" "$R0" "$R1" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWMINIMIZED "" "$(restoreNetworkTooltip)"
  !endif

  Pop $R1
  Pop $R0
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Preserve the user's shortcut choice during automatic upgrades.
  ${If} $UpdateMode = 1
  ${OrIf} $NoShortcutMode = 1
    Return
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
