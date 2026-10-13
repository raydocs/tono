## 2026-10-13 · macOS 内部候选准入改到 release/macos，构建号 76

- 归属：SHIP_PLAN G4 内部候选准备（候选 A，Wi-Fi 切换断网）。不是客户发布，不改 Sparkle / `windows-updates`。
- 来源：main `4058eb600` → 本分支；合入前无新包。
- 缺陷修复：无产品代码改动。
- 新增/优化：无。`candidate_only=true` 的签名准入从 `refs/heads/stability/desktop-0.0.75-20261005` 改到 `refs/heads/release/macos`。`CANDIDATE_VERSION` 与 `MARKETING_VERSION` 保持 `0.0.75`；`CANDIDATE_BUILD` 与 Tono 目标的 `CURRENT_PROJECT_VERSION`（Debug 与 Release）升到 76。
- 工程与测试：合同测试 `macos-candidate-workflow.test.rb` 同步新 ref 与 build 76，否则 `macos-ci` 会在旧夹具上失败。未加 `build76` 发布说明：`candidate_only` 不进入 `validate-appcast`。
- 验证：`python3 tooling/scripts/verify-desktop-version.py --expected 0.0.75` PASS（六处营销版本仍是 0.0.75）。`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` PASS（11 个 ref 用例；build 76 清单边界通过）。`xcodebuild`、签名、公证未在本机执行，交给 ci-gate 的 macos-ci。
- 候选/发布：无新包。客户源 `public/appcast.xml` 与 `public/windows/latest.json` 未改。
- 剩余限制：本 PR 不合并、不自动合并。macOS 候选要等合入后把 `release/macos` 快进到该合并提交再派发。Windows 客户发布路径仍是 `windows-release.yml`（`release/windows`），本次未派发。
