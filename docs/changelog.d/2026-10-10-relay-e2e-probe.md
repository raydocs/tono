## 2026-10-10 · 中继节点端到端探针（A5）
- 归属：运维计划 [§2](../ops/plan-2026-09-11.md)（中继可观测）；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A5；
  `services/control-plane`（迁移、上报接口、`ApiRelaysDto`）、`services/ops-console`（节点页「API 中继」卡）、
  `tooling/ops/relay/`（节点脚本与 systemd 单元）、`.github/workflows/services-ci.yml`（脚本测试进 CI）。
- 来源：基线 origin/main 6b52b07a → 分支 `amp/a5-relay-e2e-probe`；PR 待开；未合 main。
- 缺陷修复：无。Worker cron 不能指定 SNI，只能证明 2053 端口开着，TLS 转发坏了也显示「可达」。
- 新增/优化：
  - `tooling/ops/relay/relay-probe.py`（Python 标准库）：经本机 `127.0.0.1:2053`、SNI `api.afk.ccwu.cc`、
    默认证书校验（系统 CA + 主机名）请求 `GET /api/v1/health`，要求 Worker 自己的 `{"ok":true,"service":"api"}`；
    结果直接（不经中继）`POST /api/v1/home/relay-probe`。`tono-relay-probe.service`（DynamicUser、只读系统）+
    `.timer`（`OnCalendar=*:0/5`）；安装步骤与回滚写在 [api-relay.md](../ops/api-relay.md)。
  - 凭据：不新增密钥类型。复用节点上已有的出口 agent token（`/etc/tono-exit-agent/env`，D1 只存 hash，
    `authenticateExitNode` 按 hash 查）；中继由已认证节点推出（`API_RELAYS[].exitNodeId`：
    `los-angeles-westwood` / `los-angeles-mesa`），请求体不能指定中继，其他出口节点 403 `NOT_AN_API_RELAY`。
    `ok` 由控制面判定（2xx 且无错误）；`observedAt` 只收 [now−900 s, now+300 s]；旧于已存记录的上报不覆盖。
  - 迁移 `0096_api_relay_reports.sql`（新表，只加）。`ApiRelayDto.endToEnd` 为可选字段，节点未上报时不出现。
  - 控制台「API 中继」卡改为两列：「TCP 可达」（原 Worker 探测）与「端到端可用」（节点上报 + 上报时间）；
    超过 15 分钟的上报显示灰色「上报过期」，不显示绿色；未上报显示「节点未上报」。
- 工程与测试：路由经 `opsIngestRoutes` 委派，`src/index.ts` 行数不变。控制面 `test/api-relays.test.ts` 新增 1 条
  （错 token 401、非中继节点 403、上报写入、旧上报不覆盖），`test/ops-nodes.test.ts` 原有一条补 `endToEnd` 断言；
  控制台 `ApiRelays.test.tsx` 原有一条补两列断言；`tooling/ops/relay/test_relay_probe.py` 2 条（不受信证书记为失败、
  受信证书得到干净报告），并加入 services-ci `service-agents` 与路径过滤。
- 验证：见 PR 正文（本机 control-plane `npm test` 1010 通过、typecheck、check:contract、check:budgets、
  本地 D1 迁移；ops-console `npm test` 347 通过、typecheck、lint、build + budgets；Python 测试；
  脚本对两台生产中继只读探测均 200）。
- 候选/发布：仅源码，无新候选；未部署。迁移先在 preview 演练，再由部署者经 `npm run deploy` 执行。
- 剩余限制：节点安装待做（agent orb 无 SSH）；部署控制面前须核对生产 `exit_nodes.id` 与 `exitNodeId` 一致，
  不一致时节点上报得到 403。节点经直连上报，若节点自己到 Cloudflare 的直连也坏，卡片显示「上报过期」而非「不可用」。
