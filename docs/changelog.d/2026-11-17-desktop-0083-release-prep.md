## 2026-11-17 · 桌面 0.0.83 / macOS build 84 发布准备（仅源码）
- 归属：G4 候选准备；影响 Windows 与 macOS 版本字段、发布说明、候选工作流 pin。
- 来源：基线 main `1041c5606`（#1836 合并）→ 分支 `release-prep/desktop-0.0.83`。本版替代 0.0.82 RC，只多一项：中继改为 Westwood 新 IP + Mesa 两个（#1836，helper 4.52.71，Windows WFP 命名空间 9e11）。
- 新增/优化：版本 0.0.82 → 0.0.83（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj`），macOS build 83 → 84；`macos-release.yml`、`windows-candidate.yml`、`windows-installer-smoke.yml`、候选脚本与测试夹具同步。
- 验证：`verify-desktop-version.py --expected 0.0.83` PASS；`macos-candidate-workflow.test.rb` 通过；其余见 PR CI。
- 候选/发布：合并后快进 `release/windows`、`release/macos`，以 `update_release_sequence` 8301 dispatch 两个 release workflow（macOS `candidate_only`），再发双端 RC 预发布。正式更新源不推进。
- 剩余限制：与 0.0.82 相同；旧版安装仍带被封的 Westwood 地址，需手动安装本版。
