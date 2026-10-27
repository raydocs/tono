## 2026-10-27 · exit-agent 计量不丢、离线 roster 不误删、cron 写放大
- 归属：运维计划（[ops plan](../ops/plan-2026-09-11.md)），不是发布门；`services/exit-agent`、`services/control-plane` cron。
- 来源：叠在 #1776（`perf/control-plane-agent-reliability`）之上 → 分支 `fix/exit-agent-metering-durability`；未合 main，未部署。
- 缺陷修复：
  - EXIT-AGENT-ACK-FAIL-USAGE-FOLD：读完计数后的拒绝（roster ACK 失败、旧 roster 无法替换、队列/上报时钟越界、清单无法证明）改为把读数折入持久总量、不上报；红测 5,200 字节原来只计 1,200。
  - EXIT-AGENT-PARTIAL-RECONCILE-METERING：单个客户端 add/remove 失败时照常读数并上报用量，两种 ACK 都不发、仍非零退出；红测原来整节点零上报。规则见决定 139（provisional）。
  - EXIT-AGENT-EDGE-PAGE-ROSTER-DISCARD：不带 Worker JSON 错误体的 4xx（CF 1010/WAF）按不可达处理，不再删离线 roster；红测。
  - CP-CRON-UNINDEXED-SCANS（部分）：fleet verdict 只写变化的 `path_streak`；本地 2 万客户稳态每轮 20,108 → 108 条语句，墙钟 1.78 s → 0.50 s。
- 新增/优化：cron 索引候选追加到 `docs/ops/diagnostics-retention-index-candidate.sql`（本地测 274,100 → 174,100 行读/轮），未建迁移。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码；exit-agent 需在节点重新安装。
- 剩余限制：索引需 owner 在 preview D1 演练；未在真实节点复现 Xray 重启场景；hy2 与 reconcile 同时失败时仍不读数。

### 续记 2026-10-27（决定 139 owner 选 A 后）
- 缺陷修复：EXIT-AGENT-REPLAY-UNREACHABLE-FOLD——排队上报重放失败时先折算本轮读数再退出（红测 4,600 → 1,600 已修）；CP-EXIT-ROSTER-STALE-NO-ALERT——新增 `node-roster-stale` 节点事件。
- 工程与测试：新增撤销失败不 ACK 且下一轮重试、投递中断 + 重启 + 部分失败仍各字节只计一次、roster 过期告警开/关三项回归；`ops/verdict-facts.ts` 压回 500 行预算（修 #1784 的 ops-contract 失败）。
- 剩余限制：未在真实 Xray 节点验证；撤销失败期间被撤销账号在该节点仍能连接，直到移除成功或 tono-xray 重启。
