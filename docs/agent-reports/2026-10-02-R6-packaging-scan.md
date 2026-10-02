# R6 packaging scan — 2026-10-02

This scan was read-only. It looked for bugs that only appear when an app is really packaged, installed, upgraded or uninstalled, the same class as #1311 and #1312. Base: main 361a64b8. Candidates checked: 36e3194d.

## Candidates inspected (read-only, never run)

- **Windows** (`Tono_0.0.74_x64-setup.exe`, run 36943273462), extracted with 7zz:
  - The package holds `Tono.exe.next`, `tono-core.exe.next` (9d5c6f1d…) and `sing-box.exe.next` (b2e6902e…, the pinned alpha.9).
  - It also holds `resources/{tono-service,tono-service-install,tono-service-uninstall}.exe`, `core-sha256.txt`, `sing-box-sha256.txt` and `core-identity.json`.
  - The `$PLUGINSDIR/tono-gate` copies are byte-identical to the installed copies.
  - `tono-service.exe` and `tono-service-install.exe` embed both the core digest and the sing-box digest. `Tono.exe` embeds the sing-box digest.
- **macOS** (`Tono-0.0.74-build74-arm64.zip`, run 36943270858):
  - `Tono`, `tono-core-helper` and `sing-box` are Developer ID signed (YY57758GS7) with a secure timestamp and hardened runtime. Their identifiers are `com.raydocs.tono`, `com.raydocs.tono.helper` and `sing-box`, which match what `HelperManager.installScript` and `UpdatePackage` require.
  - The notarization ticket is stapled (`Contents/CodeResources`).

**Verdict:** no finding makes the 36e3194d candidates fail to install, upgrade or connect on either platform. The defects below are leftovers and provenance only.

## Findings

| ID | P | Issue / PR | Status | Evidence |
|---|---|---|---|---|
| R6-1 | P2 | #1317 / #1318 | PR open, needs-hardware, not auto-merge | Uninstall never deletes `$INSTDIR\sing-box-sha256.txt` or the helper's pin staging names, so `C:\Program Files\Tono` survives uninstall. See `installer.nsi:1305-1312` and `1626-1667`. |
| R6-2 | P3 | #1319 | open | The Service uninstaller leaves `%ProgramData%\Tono\bin\sing-box-sha256.txt(.tmp)`. See `uninstall_service.rs:845-858`. |
| R6-3 | P3 | #1320 | open | The Windows `candidate-manifest.json` omits the sing-box digest (`windows-candidate.yml:169-171`). Confirmed in the artifact. |
| R6-4 | P3 | #1321 | open (release trust) | The v1 Windows measurement treats sing-box as optional and does not cross-check duplicate copies of it (`windows-package-components.mjs:16-24,64-65`, `desktop-update-v1.mjs:47-50`). |
| R6-5 | P3 | #1322 | open | The macOS bundle ships a stale `core-identity.json` (alpha.3, 6c86720c…) while the input is alpha.9 (ab0187a7…). |
| R6-6 | P3 | #1323 | open | Every CI macOS build records `dirty:true`, because `build-core-helper.sh` rewrites a tracked helper binary that is now stale. |
| R6-7 | P3 | #1324 | open | `package-macos-dmg.sh` requires `Contents/Resources/mihomo` and has no callers. |
| R6-8 | P3 | #1325 | open | `release-version.mjs` skips `Cargo.lock` and the pbxproj, and rewrites every `version =` line. |

## Checked and consistent

- The Tauri `externalBin` and `resources` lists match what prebuild and the workflows write, and the payload allowlist.
- The sing-box pins agree across the workflows, the build scripts, `windows-packaging.mjs` and `install_service.rs`, on both platforms.
- The workflow artifact names do not collide in `desktop-update-candidate.yml` or `macos-release.yml`.
- The NSIS staging, rollback and legacy cleanup lists include `sing-box.exe.*`. The `.onInit` gate copy carries `sing-box-sha256.txt`.
- The update unpack and admission paths for macOS (`UpdatePackage.swift`) and Windows (`update.rs` `components`) agree with the measurement selectors.
- The Node entry checks (`pathToFileURL(argv[1])`) resolve correctly on Windows. The packaging scripts contain no `URL.pathname` file paths.

## Not covered

- Real install, upgrade and uninstall on hardware.
- `windows-release.yml` sing-box input (#1313, another agent).
- The `install_service.rs` transaction beyond its file sets and pins.
