## 2026-11-25 · 桌面 0.0.87 / macOS build 88 发布准备
- 归属：Windows + macOS `0.0.87`（macOS build `88`），`update_release_sequence = 8701`。
- 来源：基线 main `0759bd496`（含 #1859–#1864：macOS 应用内更新退出修复、未保护状态更新失败不误装 AI 黑洞、手动拖入新版签名包可退出挂起态、失败诊断日志与策略拒收审计，helper 协议 `4.52.76`）。
- 变更：版本 0.0.86 → 0.0.87（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`、`TrayPanel.test.tsx`），macOS build 87 → 88；同步 `macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与测试，新增 `build88`/`0.0.87` 中英文 release notes。
- 发布范围：用户授权先构建 `candidate_only: true` 签名公证候选包用于本机真机验证；**不**发布线上客户更新通道，待验证与用户明确确认后再决定是否发布。
- 未运行：本机不跑 xcodebuild / cargo / Tauri，由托管 CI 验证。
