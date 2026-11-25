## 2026-11-24 · 桌面 0.0.85 / macOS build 86 发布准备
- 归属：Windows + macOS `0.0.85`（macOS build `86`），`update_release_sequence = 8501`。
- 来源：基线 main `fb0de6260`（含 #1850 国内直连与 macOS 局域网默认开启、#1851 密钥轮换 + Windows 签名后缀热更新 + 站点/卡顿统计、#1852 `ci-gate` 收敛为 Win/Mac/Services）→ 分支 `release-prep/desktop-0.0.85`。
- 变更：版本 0.0.84 → 0.0.85（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`、`TrayPanel.test.tsx`），macOS build 85 → 86；同步 `macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与测试，新增 `build86`/`0.0.85` 中英文 release notes。
- 发布范围：Control Plane 与 Ops Console 已从 `main@fb0de6260` 部署到生产并通过 D1 `0105` 迁移；合并本 PR 后快进 `release/macos` 与 `release/windows`，以 `update_release_sequence = 8501` 触发两条签名发布流水线。
