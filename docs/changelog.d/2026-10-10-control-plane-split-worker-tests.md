## 2026-10-10 · 控制面测试：拆分 worker.test.ts，最慢用例加显式超时
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；[Amp 待办 2026-10-10](../ops/amp-backlog-2026-10-10.md) §5 A27（本机测试稳定）。
  仅 `services/control-plane/test/` 与 `vitest.config.ts` 一处注释，无产品源码改动。
- 来源：基线 origin/main（含 #1477 A28；后变基到含 #1480 A10 的 main，其新增的 otherVpn 诊断用例落入 `worker-diagnostics`）；分支 `amp/a27-split-worker-tests`；未合 main。
- 缺陷修复：无产品缺陷。起因是 [部署记录](2026-10-10-control-plane-deploy-11441941.md)：本机 `npm run deploy` 的
  `npm test` 在全量 366 秒负载下，`worker.test.ts` 的「rotates failed revocations」超过 Vitest 默认 5 秒被打断。
- 新增/优化：无。
- 工程与测试：
  - 10,222 行的 `test/worker.test.ts` 拆成 17 个主题文件（`worker-edge`、`worker-ops-access`、`worker-exit-roster`、
    `worker-usage-metering`、`worker-admin-routes`、`worker-catalog`、`worker-product-lines`、`worker-traffic-policy`、
    `worker-auth`、`worker-devices`、`worker-revocation`、`worker-roster-quota`、`worker-device-actions`、
    `worker-routing-research`、`worker-diagnostics`、`worker-telemetry`、`worker-fleet-retirement`），共享夹具
    （常量、请求助手、OIDC/Access 密钥、fetch 模拟、每测重置、`telemetryWindowPayload`）移入 `test/worker-harness.ts`，
    各文件在外层 describe 首行调用 `useWorkerHarness()`。外层 describe 名不变，测试全名不变。
  - 测试体逐字搬移；唯一改写是导入方无法给模块绑定赋值的 16 行：`++sequence` → `nextSequence()`（10）、
    `failNextX = true` → `failNext('x')`（4）、`absorbedHostFetches = []` → `absorbedHostFetches.length = 0`（2）。
    逐块比对脚本（对变基后的 origin/main）：旧 214 块（212 个 `it` 声明 + 2 个嵌套 describe）与新文件一一对应，内容差异 0。
  - 显式 15 秒超时（沿用文件里已有的 `15_000` 先例）只给实测最慢、≥0.45 秒的 8 个用例：worker-revocation 三个
    （40 个模拟 Tailscale DELETE 的两次 cron、reopen、cron 成本平稳）、worker-diagnostics 两个 retention cron、
    `ingest-budgets` 最大分段解析、`ops-ingest-hooks` 共享出口 IP、`ops-contract-routes` 全 GET 路由。全局
    `testTimeout` 与 pool（`maxWorkers: 1`）不改：Linux 上全套最慢 0.71 秒，离 5 秒默认有 7 倍余量，全局放宽会掩盖真挂起。
- 验证（Linux orb，Node 24.18.0，`services/control-plane`）：
  - 拆分前 `npx vitest run --reporter=verbose`：`Test Files 45 passed (45)`、`Tests 1008 passed (1008)`、199.65s；
    `--coverage` 同为 1008 通过、203.35s。最慢：ingest-budgets 679ms、rotates failed revocations 711ms/615ms、
    ops-ingest-hooks 584/665ms、cron 成本平稳 568ms、ops-contract-routes 515/487ms、reopen 513/450ms。
  - 拆分后 `npm test -- --reporter=verbose`（含 coverage 门槛）：`Test Files 61 passed (61)`、`Tests 1008 passed (1008)`、
    222.16s；worker 用例名排序后与拆分前逐行相同。多出的约 20 秒是 16 个文件各自的迁移与 RSA 密钥初始化。
  - 变基到含 #1480 的 main 后再跑 `npm test -- --reporter=verbose`：`Test Files 61 passed (61)`、`Tests 1009 passed (1009)`
    （原 1008 + #1480 的 1 个），245.21s。
  - `npm run typecheck` 通过（unchecked indexed access 520，基线 521）。
  - 未运行：维护者 MacBook 上的 `npm run deploy`（不部署）；Mac 负载下的耗时未测。
- 候选/发布：无新包。
- 剩余限制：「部署不再被偶发超时打断」只在 Linux 上以耗时余量论证；若维护者机器上别的用例在负载下也超 5 秒，
  需按实测再加，不预先放宽全局超时。拆分让每个文件多一次初始化，全套多约 10%。
