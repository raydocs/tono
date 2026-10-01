## 2026-10-01 · Isolate macOS silent-upgrade staging
- 归属：SHIP_PLAN §2 item 10; macOS helper; R4-MacHelperDeep.
- 来源：baseline `1826a6cf` → branch `hunt/sol-r4mh-upgrade-staging-isolation`; PR pending; not yet merged.
- 缺陷修复：overlapping administrator repair and unlocked silent copy no longer share `.new` files; cancellation removes only its private staging. Final admission and both binary renames remain under the durable update lock.
- 新增/优化：none; normal copy cancellation, authenticated update gating and existing network-protection disposition remain unchanged.
- 工程与测试：one isolated-copy cancellation self-test and one real-lock replacement lifecycle regression, authored before implementation; helper protocol/contract updated together.
- 验证：Linux `git diff --check`, findings/changelog parser and exact helper source-manifest hash; native Swift/helper tests cannot run here and require hosted macOS CI.
- 候选/发布：source only; no new candidate, deployment or publication.
- 剩余限制：P2 concurrent authorized-operation trigger; needs-hardware acceptance. Unbounded signed helper version probe is unchanged and separately known.
