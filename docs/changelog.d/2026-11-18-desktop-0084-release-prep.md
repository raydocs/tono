## 2026-11-18 · 桌面 0.0.84 / macOS build 85 发布准备（仅源码）
- 归属：G4 候选准备；影响 Windows 与 macOS 版本字段、发布说明、候选工作流 pin。
- 来源：基线 main `6d100c4a7`（#1839 合并，控制面已部署到生产）→ 分支 `release-prep/desktop-0.0.84`。本版替代 0.0.83 RC，只多一项：中继路径改用入口名 `static.bicon.dev`（#1838、#1839），绕开按 TLS 名称重置 `api.afk.ccwu.cc` 的网络。
- 新增/优化：版本 0.0.83 → 0.0.84（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`），macOS build 84 → 85；`macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与测试夹具同步。
- 验证：`verify-desktop-version.py --expected 0.0.84` PASS；`macos-candidate-workflow.test.rb` 通过；其余见 PR CI。
- 候选/发布：合并后快进 `release/windows`、`release/macos`，以 `update_release_sequence` 8401 dispatch 两个 release workflow（macOS `candidate_only`）。正式更新源不推进；不发 Android。
- 剩余限制：与 0.0.83 相同；旧版安装仍用旧入口名，需手动安装本版；更新下载仍用 `releases.afk.ccwu.cc`。
