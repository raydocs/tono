## 2026-10-10 · 中继恢复告警规则校验（A6 续）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（中继可观测）；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A6
  「恢复告警要所有者建一条 `fire_on=open_resolve` 规则」（#1510）。不是 ship gate。
- 来源：基线 main `3d973f95` → 分支 `amp/ops-relay-alert-rule-check`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - `tooling/scripts/check-relay-alert-rule.mjs`（只读，无网络）：读 ops API `GET alert-rules` 的列表、规则数组或
    `wrangler d1 execute --json` 的 `ops_alert_rules` 行，按控制面 `ruleMatches` 与冷却判断（`src/ops/alerts.ts`）逐条说明
    是否会发 `api-relay-down`（`fleet`、`warn`、影响 0）的恢复：启用、匹配字段放行、`fire_on=open_resolve`、冷却短于故障
    （默认 300 秒：能打开事故的最短故障在下一次 5 分钟检查时恢复）。有一条不限单台中继的规则才退出 0（`OK`），否则 1
    （`MISSING`）。不打印规则的 `target`。
  - [api-relay.md](../ops/api-relay.md)「Alerts」：在 ops 控制台 设置 → 告警 → 新建规则 的逐字段填法，以及两种导出
    （ops API；或不含 `target` 列的远程 D1 只读查询）后用脚本核对。
- 工程与测试：`tooling/scripts/tests/check-relay-alert-rule.test.mjs` 一条：生产形状夹具（`Email: warn and above`
  `fire_on=open` + 一条 severe webhook）→ `MISSING`、退出 1、不含收件地址；加上文档里建议的规则体（从 api-relay.md 原样解析）
  → `PASS`、退出 0；D1 行 `open_resolve` 但冷却 3600 → 报冷却原因、退出 1。`services-ci.yml` 路径过滤加入脚本、夹具与
  `docs/ops/api-relay.md`（测试读它）；`ci-gate-changes.test.mjs` 同步。
- 验证：本机 Node 24：`node --test tooling/scripts/tests/check-relay-alert-rule.test.mjs` → pass 1；`ci-gate-changes.test.mjs` 通过；
  脚本对夹具输出两条 skip + `MISSING`，退出 1。未执行：对生产规则跑（需所有者导出）；未建规则（生产 D1 写入归所有者）。
- 候选/发布：仅工具与文档，无新包；未部署。
- 剩余限制：匹配逻辑是 `ruleMatches` 的 JS 复刻，控制面改匹配规则时须同步本脚本。告警暂停开关与投递失败不在检查范围。
