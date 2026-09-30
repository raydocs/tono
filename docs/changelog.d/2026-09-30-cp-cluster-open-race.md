## 2026-09-30 · 同时打开的失败聚类不再把诊断上传打成 500
- 归属：控制面诊断聚类（运维计划范围内的 API 正确性），不进 0.0.74 客户包。
- 来源：`main` `93fb018b` 上的 `cursor/cluster-open-race-a706`（`d85b68dd`）；PR #766；未合 main。
- 缺陷修复：两份诊断在「没有打开中的聚类」读完之后同时插入时，第二条会撞上 `failure_clusters_one_open`。这条冲突现在并进已打开的那一行并加一，不再把整次上传变成 500。
- 新增/优化：无。先插入成功的那次仍负责打开告警；输掉插入的那次也可能再发一次 opened 告警。
- 工程与测试：`diagnostics-clusters.test.ts` 把两次打开读挡住，直到两边都读完再插入。
- 验证：`npx vitest run test/diagnostics-clusters.test.ts`，10 passed。修复前同一条失败于 `UNIQUE constraint failed: failure_clusters.group_key`。
- 候选/发布：仅源码，无新包。
- 剩余限制：未在生产 D1 上复现并发；告警仍可能各发一次。
