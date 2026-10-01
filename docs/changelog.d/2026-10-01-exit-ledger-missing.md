## 2026-10-01 · 出口代理丢失账本时不再把原始计数重复计费
- 归属：ops 计划里的出口计量；`services/exit-agent`、`services/control-plane` 的 `/api/v1/home/exit-identities`。
- 来源：main `33d46892` → 分支 `cursor/exit-agent-missing-ledger-f0e7`；PR #914；未合 main。
- 缺陷修复：`EXIT-LEDGER-MISSING`。状态文件缺失时 `load_state` 交回空账本，原始计数被当成终身用量上报；控制面见到更低的新总量会整段加到已有水位上。改后名册在已认证节点上带上该节点的 `sourceUsageBytes`。水位更高时本地累计改记水位，基线留在当前原始读数，之后只计新增。名册没有该字段时，缺失账本本轮不把原始计数报出去。水位为 0 的第一次读数、以及本地已经高于水位的读数，仍按原来的折叠。
- 新增/优化：无。
- 工程与测试：名册响应从 `index.ts` 挪到 `exit-identity-roster.ts`。一条 vitest 断言已计费账户的水位和未计费账户的 0。exit-agent 用 unittest 覆盖采用水位、无水位不发布、零水位保留首读、本地领先不回拉，以及一轮缺失账本上报的是水位而不是原始计数。
- 验证：Linux 上 `python3 -m unittest test_reconcile_and_report` 108 通过；`npx vitest run test/worker.test.ts -t "names each exit identity with this node source watermark"` 1 通过；`test/index-size.test.ts`、`check-ops-budgets`、`check-ops-contract-purity`、`tsc --noEmit` 通过。`cargo test` 与本改动无关，未跑。未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在真实节点上删掉状态文件复现。控制面「更低总量整段累加」保持不变，真实的 xray 重建仍靠它入账。名册没有水位字段的旧控制面，缺失账本的当轮原始计数不入账，下一轮只计增量。
