## 2026-09-30 · 指标支持原型属性同名节点
- 归属：ops 指标；control-plane timeseries。
- 来源：origin/main `f80951fb` → `hunt/sol-cp-metrics-node-names`，本 PR；尚未合 main。
- 缺陷修复：constructor 等合法节点名导致指标查询 500 → 使用无原型字典保存指标数组。关联 SOL-CP-METRICS-NAME。
- 新增/优化：无；查询和 JSON 合同保持。
- 工程与测试：新增一条节点名冲突回归，包含查询和 JSON 序列化；修复前失败、后通过。
- 验证：Linux / Node24；timeseries、typecheck 和全量 npm test 结果记录在 PR；未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机操作或线上实例验证。
