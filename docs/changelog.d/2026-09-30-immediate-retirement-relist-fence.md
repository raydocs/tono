## 2026-09-30 · Immediate retirement respects a later catalog relist
- 归属：SHIP_PLAN §2 item 9 / control-plane catalog authorization.
- 来源：origin/main → `hunt/sol-r4cp-retire-relist-fence`; PR pending, not merged.
- 缺陷修复：Concurrent relist committed before retirement cleanup could still have its exit token disabled → both immediate revoke callers use the existing catalog revision fence. Finding R4CP-RETIRE-RELIST-FENCE.
- 新增/优化：无; node drain, token rotation and relist admission remain unchanged.
- 工程与测试：One real D1 regression for the direct retire caller, one for the retirement job; both failed with listed node / disabled token before the fix.
- 验证：Linux/Node24; ops-jobs16tests passed; npm run typecheck passed (unchecked-index521/521,97/99). Baseline full CP suite46files974tests passed before this change; relevant file re-run after it.
- 候选/发布：仅源码，无新候选; no deploy/publish.
- 剩余限制：P2 administrator concurrency; needs-hardware, no installed-node validation.
