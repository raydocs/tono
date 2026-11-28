## 2026-11-27 · PR 1：控制面 `node-home` 双身份下发、D1 迁移与 `routingSha256` v2 向量
- 归属：Ops 专项（[Node-Side Residential SOCKS5 RFC](../proposals/node-side-residential-socks5.md) PR 1）；影响模块 `services/control-plane/`、`tooling/scripts/tests/`。
- 来源：`main @ 484eaddd1` → 分支 `feat/node-home-pr1-control-plane`（严格遵循 PR 0 实测结论：`rmo` 不切断已建立长连接，继续保留 `migrations/0080` 解绑换密门禁）。
- 缺陷修复：无（现网默认仍为 `legacy_socks5` 与 v1 `routingSha256`，不改变旧客户端行为）。
- 新增/优化：
  1. **D1 增量迁移 `0106_node_home_socks5.sql`**：为 `home_exits` 与 `exit_nodes` 增加只增列（保持 `0036` 的 `metering_protocol_version IN (1, 2)` 约束并在 `node_home_metering_version` 记录 v3+），新增 `device_home_credentials`、`home_exit_nodes`、`home_exit_drain_acks`、`home_outbound_deliveries` 及 5 条单行解绑/停用触发器；保持 `0080` 换密触发器完好。
  2. **作用域下发与 `503` Fail-Closed**：[node-home.ts](../../services/control-plane/src/node-home.ts)、[catalog.ts](../../services/control-plane/src/catalog.ts)、[exit-identity-roster.ts](../../services/control-plane/src/exit-identity-roster.ts)、[request.ts](../../services/control-plane/src/request.ts) 实现 `node_only` 模式拒绝对旧端下发 `homeSocks5`（返回 `503 CATALOG_UNAVAILABLE` + `Retry-After`）、在未获节点 ACK 前拒绝签发不完整目录（`503`）、按 `home_exit_nodes` 仅向已验证单节点 token 且完成 `metering >= 3` / Xray 白名单校验的节点下发 `homeIdentities` 与最小作用域 `homeOutbounds` 并写入审计记录；同步抽出 `roster-ack` / `metering-ack` 保持 [index.ts](../../services/control-plane/src/index.ts) 低于 1724 行预算。
  3. **跨端 `routingSha256` v2 共享测试向量**：[routing-digest-v2-vectors.json](../../tooling/scripts/tests/fixtures/routing-digest-v2-vectors.json) 与 [routing-digest-v2-vectors.test.mjs](../../tooling/scripts/tests/routing-digest-v2-vectors.test.mjs) 锁定 8 段 `\n` 前像与 UTF-8 字节排序规则。
- 工程与测试：新增控制面全链路测试 [node-home.test.ts](../../services/control-plane/test/node-home.test.ts)。
- 验证：本机已跑通过全部控制面检查（`npm run typecheck` 521/76、`npm run check:contract`、`npm run check:budgets`、`npm test` 75 文件 / 1119 测试全绿）、`node tooling/scripts/check-migration-numbers.mjs`、`tooling/scripts/rehearse-control-plane-migrations.sh --high-water 0105`（本地 D1 增/全量与幂等重放通过，注：`0103` 为历史拓宽列迁移故以 `0105` 为演练基准）、`node --test "tooling/scripts/tests/*.test.mjs"`（168/168）、`tooling/scripts/test-suite-reachability.sh`（68/68）、`node tooling/scripts/records.mjs changelog --since 2026-11-27` 与 `git diff --check`；托管 `ci-gate` 待推送后验证。
- 候选/发布：仅控制面 PR 1 代码，尚未合入或部署至生产 Worker / D1。
- 剩余限制：节点端 `exit-agent` 对接（PR 2）与四端客户端 `homeTunnel` + v2 摘要实现（PR 3 / PR 3b）在后续 PR 分阶段推进。
