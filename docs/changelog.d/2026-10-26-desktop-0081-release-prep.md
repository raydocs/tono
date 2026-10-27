## 2026-10-26 · 桌面 0.0.81 / macOS build 82 发布准备（仅源码）
- 归属：G4 候选准备；影响 Windows 与 macOS 版本字段、发布说明、候选工作流 pin。
- 来源：基线 main `0c0e6d7fb` → 分支 `release/prep-0.0.81`；未合 main。功能修复在 PR #1759（Windows）、#1760（macOS）、#1761（控制平面），本条不含它们的代码，合并顺序：三个修复 PR 先，本条后。
- 缺陷修复：无。
- 新增/优化：版本 0.0.80 → 0.0.81（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj` MARKETING_VERSION），macOS build 81 → 82；`macos-release.yml` CANDIDATE_VERSION/BUILD、`windows-candidate.yml` 的版本期望与制品名、`windows-installer-smoke.yml` 制品名、`test-windows-candidate-install.ps1` 守卫同步；发布说明 `apps/windows/release-notes/0.0.81.md/.zh.md`、`apps/macos/release-notes/build82.md/.zh.md`（替代 0.0.80 RC 的手动安装测试候选，不是稳定验收或更新源推广）。`docs/reports/update-prep-2026-10-24` 与 `update-feed-dry-run.mjs` 是 10-24 的冻结 dry-run 记录，保持 0.0.80 不动。
- 工程与测试：`tooling/scripts/tests/macos-candidate-workflow.test.rb` 的合成 fixture 改为 0.0.81/build82，过期用例改为 0.0.80/build81；`TrayPanel.test.tsx` 更新提示版本随之上调。
- 验证：`python3 tooling/scripts/verify-desktop-version.py --expected 0.0.81` PASS（六处一致）；`pnpm vitest run src/tono-ui/TrayPanel.test.tsx` 18 通过；`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 通过；`node --test tooling/scripts/tests/update-feed-dry-run.test.mjs` 通过。未执行：release/windows、release/macos 的快进与 `windows-release.yml`/`macos-release.yml` 的 dispatch（需 `update_release_sequence`，0.0.80 用的是 8001，由所有者定）。
- 候选/发布：无新包。SHIP_PLAN §6 G1–G3 未勾、签名/公证/Sparkle 密钥、实机测试、G4 更新源推进均为所有者操作。
- 剩余限制：发布说明里的「本候选另加」测试项依赖 #1759/#1760 合入；若有修复 PR 未合，构建前要改说明。
