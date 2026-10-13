## 2026-10-12 · 运维台：客户端页的采用率总句按人去重，矩阵格子点进客户页按所选平台判档
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/control-plane`（ops 契约与 Worker）和 `services/ops-console`；#1058 的 `O1-ADOPTION-TOTAL`、`O1-ADOPTION-DRILLDOWN`。
- 来源：基线 `origin/main` → 分支 `fix/ops-adoption-people`；未合 main。
- 缺陷修复：
  - 客户端页的采用率总句改为按人去重：一个人在两个平台只算一次，按其已上报设备里最旧的版本归档。此前总句把各格的 `users` 加起来，有一台 Mac 和一台 Windows 的客户在两格里各算一次，「N 位在最新版 · N 位落后 · N 位未上报」比实际人数多。矩阵各格的算法不变（一格回答“这里至少有一台设备的客户有多少”）。
  - 从矩阵格子点进客户页时按所选平台的最旧版本判档，不再被另一平台的旧设备带偏。此前客户页拿跨平台的 `minAppVersion` 去比所选平台的发布列表，Windows 已是最新、Mac 还很旧的客户会落进错误的档，从他被点的那一格里消失。
- 服务端 DTO：`GET /api/v1/ops/releases/adoption` 新增 `people: { current, behind, unreported }`（每人取最差档；只有所有设备都没报出可归档的版本才算未上报；只数已发布平台上的设备）；客户摘要 `CustomerSummaryDto` 新增 `versionByPlatform: { platform, version }[]`（每个平台上最旧的版本，窗口与 `minAppVersion` 相同，30 天；没上报过版本的平台不出现）。`minAppVersion` 不变。
- 工程与测试：契约断言加入两个新字段，fixture（含 `fixtures/captured`）同步；生成器给每位客户写 `versionByPlatform`，混合平台客户的 Mac 与最旧版本一致，使矩阵 fixture 与客户 fixture 仍然对得上；`test/ops-fixtures.test.ts` 的格子对账改按平台版本，并新增 `people` 对账；`ops-releases.test.ts` 加两例（同一人 Windows 最新、macOS 落后两版 → 两格都在、`people.behind` 为 1；设备版本未知 → `people.unreported` 为 1），`ops-api.test.ts` 加一例 `versionByPlatform`，`customers.test.ts` 加一例所选平台判档；这些例子在旧代码上均失败。
- 部署：随 control-plane 部署，无迁移；控制台的断言要求新字段，必须与 Worker 同时部署。
- 剩余限制：矩阵的窗口是所选的时间范围，客户页判档用的是 30 天，两者的窗口不同，范围短于 30 天时仍可能对不上。
