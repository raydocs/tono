## 2026-09-30 · Keep HY2 customers in the node retirement drain
- 归属：SHIP_PLAN §2 item 10; ops plan retirement and same-node HY2 identity.
- 来源：origin/main 7d525e6c → hunt/sol-cp-hy2-retire-drain; PR pending, not merged.
- 缺陷修复：Recent HY2 selections were missed by retirement dependencies, so exit admission was withdrawn before drain; the verdict also cleared retire_pending. Both selections now count against their base node; default-binding dependency counts include the alias too.
- 新增/优化：无; no extra machine identity, change to strict protection or release policy.
- 工程与测试：One regression retires a node used through HY2, covers customer/device status, unchanged active token and pending incident after the verdict pass.
- 验证：Node24/Linux: regression failed before fix (empty customersOnNode); ops-jobs/verdict suites 21 passed; typecheck and ops budgets passed. Full suite: 44 files / 950 tests passed.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：needs-hardware; no installed client or exit-agent network behavior exercised here.
