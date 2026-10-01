## 2026-10-01 · Windows core selection: amend decision 040, retryable Service probe
- 归属：SHIP_PLAN §2 item 10; Windows connect core selection (#1197).
- 来源：origin/main e2bf1603; fix/win-1197-core-select; source PR, not yet merged.
- 缺陷修复：#1197 point 2. Any failed `get_version` probe was reported as "this Tono Service cannot run sing-box; install the current service". Now only an answered protocol below the sing-box revision gives that message; an IPC error, a non-zero code or a missing protocol body fails the connect before arm with "could not confirm ... try connecting again".
- 新增/优化：#1197 point 1 is a decision change, not code: decision 040 gains a provisional amendment allowing the Protected Offline (WFP wanted/live, core exited) fallback to mihomo and an explicit `core: mihomo` switch, because StartClash re-renders the tunnel permit and refusing would cut the network. A live, Service-proven core being replaced still refuses the automatic fallback.
- 工程与测试：one `#[test]` in `core_select.rs` (`a_failed_version_probe_is_retryable_not_an_old_service`).
- 验证：`rustfmt --edition 2024 --check` on the changed file passed locally. cargo test runs in hosted CI only (not run on the MacBook).
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：the amendment is provisional until the owner answers.
