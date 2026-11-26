## 2026-11-26 · 桌面 0.0.88 / macOS build 89 发布准备
- 归属：Windows + macOS `0.0.88`（macOS build `89`），`update_release_sequence = 8801`。
- 来源：基线 main `facd1dfb3`（含 #1866–#1868：抢占式恢复 UI 去重、PF 探针与独立更新退出栅栏、`CoreManager.sync` 中断恢复与 Helper 协议 `4.52.78`、节点切换原位回滚与 Strict 模式防护、DelayGate 诊断绕过、IPC 空响应受控重试、更新退役/登录恢复与 Tahoe UI/UX 精细化打磨）。
- 变更：版本 0.0.87 → 0.0.88（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`、`TrayPanel.test.tsx`），macOS build 88 → 89；同步 `macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与工作流契约测试，新增 `build89`/`0.0.88` 中英文 release notes。
- 发布范围：由已合入 `main` 的 `release/macos` 与 `release/windows` 分支分别触发 `macos-release.yml` 与 `windows-release.yml`（`version=0.0.88`，`update_release_sequence=8801`）。
- 未运行：本机不跑 `xcodebuild test` / `cargo` / Tauri 完整构建，由托管 CI 验证。
