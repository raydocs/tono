## 2026-10-01 · Windows sing-box DIRECT replacement waits for a hot switch
- 归属：SHIP_PLAN §2 item 10; Windows sing-box DIRECT (RegLate review of #1175).
- 来源：origin/main 0aed06a5; hunt/claude-r4late-singbox-direct-admission; source PR, not yet merged.
- 缺陷修复：WIN-SINGBOX-DIRECT-SWITCH-RACE, the sing-box DIRECT process replacement now takes the same policy/mutation admission and context recheck as the mihomo DIRECT bracket, so it cannot restart Core on a node or policy a hot switch or policy update has already left.
- 新增/优化：无。Release, AI-hold and strict-mode behavior unchanged.
- 工程与测试：one tokio regression holds the policy writer, proves the admission waits, changes the selected node and expects Stale.
- 验证：`rustfmt --check` (apps/windows/app/rustfmt.toml) shows no diff on the changed lines; cargo test runs in hosted CI only.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：real Windows hot switch during sing-box DIRECT needs hardware (needs-hardware).
