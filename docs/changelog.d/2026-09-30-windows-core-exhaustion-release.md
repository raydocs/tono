## 2026-09-30 · Windows releases exhausted Core recovery through the existing lifecycle fence
- 归属：SHIP_PLAN §2 item 10; Windows Service manager and WFP recovery.
- 来源：baseline `3ea3fd01` → branch `hunt/sol-r3wfp-core-exhaustion`, 本 PR; source only, not yet merged.
- 缺陷修复：unavailable App recovery plus exhausted Core retries left healthy Blocked WFP indefinitely → queue the original arm for #1021's independent lifecycle cleanup, releasing general traffic with the AI hold. Strict opt-in and successor arms remain protected. Finding WIN-CORE-EXHAUSTION-HEALTHY-BLOCK (P2).
- 新增/优化：无。Unfixed DHCPv6 relay compatibility decision recorded separately; no permit widening.
- 工程与测试：one actual-watchdog regression authored before implementation; one narrow regression each for strict preservation and successor-arm fencing.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2. Baseline exhaustion regression: 0 passed / 1 failed; fixed targeted regressions: 3 passed. WFP suite: 104 passed. Manager suite: 9 passed. Independent read-only reviews found no lifecycle or successor-fence blocker.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：native Windows WFP/DNS/TUN and installed-device failures require CI/hardware; existing cleanup failures may delay recovery. Ownerless legacy intents remain excluded. General release keeps the existing best-effort AI layer and its documented limits.
