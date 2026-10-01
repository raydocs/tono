## 2026-09-30 · Exit retirement validation timeout preserves revocation inventory
- 归属：SHIP_PLAN §2 item 9 (credentials and privacy); exit-agent authorization and accounting.
- 来源：origin/main `7f382af7` → `hunt/sol-r4cp-retirement-timeout`; PR pending, not merged.
- 缺陷修复：Xray static config validation timeout after adding clients skipped inventory durability → timeout follows the existing deferred persistence refusal, allowing inventory/usage to be saved and the next roster to revoke every known client. Finding R4CP-RETIRE-VALIDATION-TIMEOUT, sibling of #1009.
- 新增/优化：无; existing static-config validation, revocation, billing and refusal behavior retained.
- 工程与测试：One integrated two-round unittest uses real reconciliation and retirement persistence, simulates the validation CLI timeout, verifies metering/config cleanup and later revocation without live client listing.
- 验证：Linux/Python 3.13; regression failed before fix with uncaught TimeoutExpired; after fix 1 passed; full exit-agent suite 111 passed. No installed-node execution or deployment.
- 候选/发布：仅源码，无新候选; no deploy/publish.
- 剩余限制：needs-hardware; installed Xray acceptance remains for the final device/node pass.
