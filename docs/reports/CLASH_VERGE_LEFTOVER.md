# Clash Verge leftover inventory

Target: production runtime, UI, logs, package names, and payload must not
use `clash-verge` or `verge-mihomo`. Allowed hits: migration, notices,
LICENSE, historical tests.

## Done

- Windows app crate: `tono-windows` 0.0.35.
- Workspace crates are real Tono crates (no Cargo alias):
  `tono-logging`, `tono-signal`, `tono-draft`, `tono-i18n`,
  `tono-limiter`, `tauri-plugin-tono-sysinfo`, `tono-logger`,
  `tono-plugin-core`, `tono-service-protocol`.
- Git deps `clash-verge-logger` and `tauri-plugin-mihomo` replaced by
  in-tree crates.
- Production core name is `tono-core` / `tono-core.exe`.
  `verge-mihomo` remains only for leftover process sweep and installer
  cleanup.
- `sysproxy` is vendored at `apps/windows/vendor/sysproxy` (no
  clash-verge-rev git URL).
- Core IPC pipes/sockets and owner token use `tono-core` /
  `.tono-service-owner-token`. The old token file is still read on
  upgrade.
- Optional DIRECT no longer sits on the Connected critical path. Cold
  connect budget is 208s accounted / 240s cap (was 328/360).
- macOS types/files: `CoreControllerClient`, `CoreRuntimeManager`,
  `CoreControllerError`, `CoreRuntimeError`.

## Still leftover (allowed or later)

| Location | Why it stays |
| --- | --- |
| Process sweep `verge-mihomo.exe` | Upgrade leftover: stop an old image holding port 53 |
| Owner token `.clash-verge-service-owner-token` | Read-only upgrade of the previous token file |
| Backup dir `clash-verge-rev-backup*` | Adopted into `tono-backup` on first use |
| `LEGACY_MACOS_SERVICE_IDS` / PF / GID aliases | Dual-read so a rename cannot leave a second helper or PF block |
| Import-from-Clash-Verge copy, WebDAV/Advanced UI | Migration / leftover product surface, not the owned runtime |
| Historical tests and docs | Allowed |

`rg -i "clash[-_ ]verge|verge-mihomo"` in production runtime, UI chrome,
logs, and payload names should only hit the allowed categories above.
