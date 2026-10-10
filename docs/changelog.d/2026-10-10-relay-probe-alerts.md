## 2026-10-10 · 中继探测失败告警（A6）
- 归属：运维计划 [§2](../ops/plan-2026-09-11.md)（中继可观测）；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A6；
  `services/control-plane`（`src/ops/relay-alerts.ts`、`verdict-run.ts`、`alerts.ts`）。
- 来源：基线 origin/main（含 A5 #1489）→ 分支 `amp/a6-relay-alerts`；PR 待开；未合 main。
- 缺陷修复：[OPS-ALERT-RESOLVE-SUPPRESSED](../findings.d/OPS-ALERT-RESOLVE-SUPPRESSED.md)：`fire_on=open_resolve`
  的规则从来发不出「恢复」，因为发送时事故已是 resolved，被「延迟期内已恢复」那条检查当成过时投递压掉。
  现在这条检查只压 open / escalate；resolve 照常发送（冷却、暂停与重试规则不变）。
- 新增/优化：
  - 每次 ops 判定（cron 的 `all` 与节点上报的 `none`）为每个 API 中继生成一条事故，kind `api-relay-down`、
    对象 `fleet/<host>:<port>`、级别 `warn`，走现有 `ops_alert_rules` 发件箱。
  - 判定：TCP 探测（Worker cron）或端到端上报（A5）任一连续 3 次失败即打开；端到端另以「上报超过 15 分钟」
    （与控制台「上报过期」同一条线，即连续漏了 3 次 5 分钟上报）计为失败；从未上报的节点只看 TCP。
    两路都恢复的第一次检查即关闭。连续次数不落库：两路都每 5 分钟一次，成功会清 `failing_since`，
    所以次数 = `round((最近一次 − failing_since) / 300) + 1`。不加迁移。
  - 一次状态变化一条消息：事故开着时只原地刷新详情，第 4 次失败不再发；再次打开需要新的 3 次失败。
  - 只认 `API_RELAYS` 里的中继，已撤的中继残留行不会一直告警。说明与建议规则写进 [api-relay.md](../ops/api-relay.md)「Alerts」。
- 工程与测试：`test/ops-verdict-run.test.ts` 新增 1 条 `it`：一台中继 TCP 连续失败（带几秒 cron 抖动），
  第 3 次恰好一条 `incident.open`、第 4 次无、恢复恰好一条 `incident.resolve`，另一台健康中继无消息。
  修复前该条在恢复处失败（收到 0 条）。
- 验证：见 PR 正文。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：生产现有两条规则都是 `fire_on=open`，所以部署后只会收到「打开」；要收到「恢复」需所有者加一条
  `open_resolve` 规则且冷却短于故障时长（建议见 api-relay.md），本 PR 不写生产 D1。中继告警不分级：
  两台同时坏仍是两条 `warn`。ops cron 在同一 tick 里先于中继探测运行，告警比第 3 次失败晚一个 tick（≤5 分钟）。
