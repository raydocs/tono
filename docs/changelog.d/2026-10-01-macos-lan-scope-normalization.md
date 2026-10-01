## 2026-10-01 · Refresh macOS LAN DNS scope from loaded PF rules
- 归属：SHIP_PLAN §2 item 10; macOS helper; R4-MacHelperDeep; follow-up to #894 / merged #979.
- 来源：baseline `c6c08737` → branch `hunt/sol-r4mh-lan-scope-normalized`; PR pending; not yet merged.
- 缺陷修复：aggregate expanded `pfctl -sr` interface rules so new physical NICs trigger widening. Reload changes only managed LAN DNS blocks, preserving all live DIRECT permits and PF states.
- 新增/优化：none; unscoped blocks remain global; unknown/withheld source waits for the next committed arm; no repair flag or reconnect is introduced.
- 工程与测试：expanded-output parser regression, permit-preservation/refusal regression, and native loaded-output assertion in the existing unreferenced lifecycle anchor; authored before implementation. Helper protocol/contract updated together.
- 验证：Linux `git diff --check`, records parser, exact source-manifest hash and two independent source reviews; Swift and live PF tests require macOS CI.
- 候选/发布：source only; no new candidate, deployment or publication.
- 剩余限制：P2 LAN DNS/DoT gap, no full AI bypass claim; needs-hardware hotplug qualification. No state flush or change to strict/automatic recovery disposition.
