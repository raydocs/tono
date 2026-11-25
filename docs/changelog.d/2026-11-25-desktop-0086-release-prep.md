## 2026-11-25 · 桌面 0.0.86 / macOS build 87 发布准备
- 归属：Windows + macOS `0.0.86`（macOS build `87`），`update_release_sequence = 8601`。
- 来源：基线 main `184101b0c`（含 #1856 签名 TCP 直连 IP；生产 traffic-policy 已是 rev 11，带 18 个 `tcpDirectAddresses`，Control Plane 已部署同一提交）。
- 变更：版本 0.0.85 → 0.0.86（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`、`TrayPanel.test.tsx`），macOS build 86 → 87；同步 `macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与测试，新增 `build87`/`0.0.86` 中英文 release notes。
- 发布范围：用户在对话中授权全量发布；合并本 PR 后快进 `release/macos` 与 `release/windows` 并签名构建。
- 未运行：本机不跑 xcodebuild / cargo / Tauri，由托管 CI 验证。
