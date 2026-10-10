## 2026-10-10 · 运维后台：客户 ASN × 控制面路径 7 天成功率表
- 归属：运维计划 [§2](../ops/plan-2026-09-11.md)（中继可观测）；[待办](../ops/amp-backlog-2026-10-10.md) A8；
  `services/control-plane`（迁移 0099、`client-identity.ts`、`api-paths.ts`、ops 读接口）与 `services/ops-console`（节点页）。
- 来源：基线 main → 分支 `amp/a8-asn-path-success`；PR [#1490](https://github.com/raydocs/tono/pull/1490)；未合 main。迁移号 0099 由协调者分配（0096–0098 预留给 A5 / A20 / A21）。
- 缺陷修复：无。此前服务端只存设备「最近一次」路径（`devices.client_path`），没有按请求的路径计数，也没有任何路径失败数据：
  客户端不发 `signInFail`，macOS 的 `control_plane_path_failed` 只在本机审计日志里，Windows 还没有对应事件（A19）。
- 新增/优化：
  - [决策 080](../decisions/080-2026-10-10-api-path-failure-header.md)（provisional）：可选请求头 `X-Tono-Path-Failed`
    （逗号列表，词表同 `X-Tono-Path`，未知或畸形项丢弃，超 96 字符视为没发）列出本次请求到达前失败的路径；发了头（可为空）即「上报客户端」。
  - 迁移 `0099_ops_api_path_daily.sql`（新表）：按 UTC 日 × 客户 ASN × 路径记 `arrived`（所有被打戳的到达）、`ok` / `fail`
    （只来自上报客户端）、`as_org`、`updated_at`。只在 `recordClient` 已经写设备行（路径变化或超过一小时）时写，五分钟目录轮询不新增写；
    `relay` / `tunnel` 或来自已知出口 ASN（`ops_exit_asns`）的请求记 ASN 0（未知），不把节点 ASN 算给客户；不存 IP、URL 路径、用户或设备 id。
    ops cron 保留 90 天。
  - `GET /api/v1/ops/api-paths`（`nodes.read`）返回 `ApiPathsDto`（有检查器、路由表行、`docs/ops/api-contract.md` 一行）；
    `successRate` 是 `Measured<number|null>`，没有上报客户端时为 null，控制台显示「— 无数据」，不显示 100%。
  - 控制台节点页在「API 中继」卡之后加「客户网络 × 控制面路径 · 7 天」表（客户 ASN / 路径 / 到达 / 先失败 / 成功率），
    fixture 模式读 `fixtures/api-paths.json`。
- 工程与测试：控制面 `test/api-paths.test.ts` 一条（7 天窗口、按 ASN × 路径计数与成功率、relay 与出口 ASN 记未知、不上报的行成功率为 null、
  同路径一小时内不重复计数）。控制台无新单测 / Playwright；夹具页截图贴 PR。`index.ts` 未改。
- 验证：见 PR 正文（本机 control-plane typecheck / check:contract / check:budgets / `npm test`；ops-console typecheck / lint / `npm test` / build / check-budgets）。
- 候选/发布：仅源码，无新候选；未部署。迁移为纯新增，生产前先在 preview 演练（运维计划 §2 item 1），由部署者经 `npm run deploy` 执行。
- 剩余限制：客户端还不发 `X-Tono-Path-Failed`，上线前每行成功率都是「无数据」（后续客户端 PR）；计数单位是「设备 × 路径 × 小时」打戳，不是请求数；
  ASN 来自请求边缘，客户本机 ASN 不上报；`ops_exit_asns` 漏记的出口 ASN 会被当成客户 ASN。
