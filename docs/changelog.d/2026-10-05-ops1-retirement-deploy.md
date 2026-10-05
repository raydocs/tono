## 2026-10-05 · 退役 ops1，只保留新版运维后台

- 归属：运维计划 §6（旧 UI 退役）、§2 项 7（部署前导出）；不推进客户 SHIP_PLAN。
- 来源：[#1377](https://github.com/raydocs/tono/pull/1377) 精确 head `5534f39099c1b44254fade8c03488f4cc3e294c4`，合并提交 `933436cb8b90367646cb2d4e5e08f68929c029a1`（18:17:48 UTC）。手动 ready/merge，经配置的合并机制，无 UI auto-merge、无 admin bypass。
- 缺陷修复：7 个本批 finding 以 `fixed(933436cb)` 更新；旧书签对象/时间窗口、搜索范围提示及隐私匹配的原失败/续修证据仍在[收敛记录](../ops/console-consolidation-2026-10-04.md)，不改写成从未失败。
- 新增/优化：仅构建 `services/ops-console/`，canonical `/ops2/`；旧根和 `/ops/` 兼容重定向/hash 迁移，旧 UI 入口/页面/私有组件/样式及专用构建已删除，旧生成目录已清理。共享 lib/API 类型、legacy API 和采集器保留。用量页提供 24h/7d/90d，不改计量、API 合同或数据迁移。
- 工程与测试：
  - 精确 head 的 [ci-gate run37353162802](https://github.com/raydocs/tono/actions/runs/37353162802) 成功，所有相关 jobs 成功；没有以旧 head 的绿充数。四个行为 E2E shard 通过；未重生成 macOS 像素基线。
  - trusted main 路由决定 `f6f73ae4`、双厂商 high finder；全 diff `937f6bab`、续修 `2edd381f`、最终局部修正 `779e9a66` 均完成。最终 `PASSED / 0 findings`；两 finder 为 Opus 5.5/high 和 GPT-6.1-sol/high，交叉 verifier 实际 medium。范围/闭合/实际复现见 [PR 审查回执](https://github.com/raydocs/tono/pull/1377#issuecomment-6000282646)。
  - 集成核对范围 `107ce6d9..933436cb`（路由 `16b06e5c`）：`git diff --exit-code 5534f390..933436cb -- services/control-plane services/ops-console tooling/scripts` 实际为空，部署输入逐字节等于已审 head；merge `--cc` 无冲突修正。复用上述精确审查，不再次让模型重审整个报告。同期 #1193 的 Windows 日志修正另有 `38cf6f24` 的 Codex high round2 clean 回执；本次不构建/发布 Windows。无未覆盖的控制面高风险集成改动。
  - MacBook 部署脚本实跑：44 文件/1000 Worker 测试、typecheck、策略签名契约、单控制台构建/预算、release-center check 通过；控制台最终已有 44 文件/345 测试、type/lint 通过，204.6KB/317.2KB gzip。无新增 UI 测试、Playwright 用例或基线。部署时两次迁移检查均“无待应用”；0093 已由前一部署在 preview/生产应用，本次不领取其迁移功劳。
- 部署：在干净、与 origin/main 相等的维护者 `main@933436cb`、`tono` profile 中运行 `npm run deploy`，退出0。API Worker version `1c8a01d5-93a7-4c9c-82cb-034ebc83aad6`，Admin `eef17a61-a120-4596-bbb0-47d3de27b911`（18:20:47 UTC、100%、tag `main-933436cb8b90`）；脚本实报两 Worker 同源。
- 备份：部署前上传 R2 `backups/control-plane-d1/2026-10-05T18:10:56Z.sql.gz` 与 `.sha256`，SHA-256 `863401185694f440ea2397592bdfdf3ec7a8bfdbcf8b6ebbe3c90784e5954ad7`，本地 `shasum -c` OK。没有生产恢复、临时补迁移或第三方密钥创建。
- 生产核对：`/api/v1/system/version` 是完整 `933436cb…`；`/system/pulse` 为 `ok:true,cronAgeSec:85`。API 主机根404；匿名 `/ops2/` 从部署前200变为401，`/ops2/index.html` 和 `/ops2/assets/unknown.js` 同为401，管理健康接口仍401。实际产物 `public/ops/` 缺失、`public/ops2/index.html` 存在；Admin deployment metadata 100% 对齐同一 SHA。匿名资产不泄露，不把401当作已登录页面验收或旧资产404证明。
- 邮件：owner 确认日常使用/真实事故完成、指定邮件收件人和 Telegram 后补。配置前另有17:47:51 UTC D1备份（SHA `b691557923abfb5f14fd12523487dc2f705b5f6805b7eae6463a75108b988a53`）；本任务排队的一条当前真实 severe/open 事故投递为 `sent,attempts=1,HTTP200,sent_at=17:53:02 UTC`，不是收件箱签收。随后发现并行任务较早同收件人的规则：仅停用本任务新增的 `ops-email-owner-20261005`，保留早先 `2dd81896-28cb-4cbc-b332-9ff7fa0631f0`（warn/open/0秒延迟/3600秒冷却），不改他人配置；实读只有一条启用规则，真实投递回执保留，有 system 审计。见[决定058](../decisions/058-2026-10-05-deduplicate-ops-email-rule.md)。地址和 API key 不入仓库，没有假事故。
- 候选/发布：无客户端包、客户发布或更新源变更；这是 Worker/后台上线。
- 剩余限制：生产 Access 登录后的私有页面/旧书签人工验收未做，浏览器 space17 已交还控制。普通用量榜→对象没有额外显式原窗口返回；未来无扩展名顶层资产需收窄重定向；均记录为非当前阻断建议。决定编号055的两个并行文件按完整路径识别，本任务不重命名他人的决定。回滚：分别用 `wrangler rollback` 恢复 API `16549f87-427a-4a7e-99f2-55df811907a8` 与 Admin `5621abf7-b9d9-488a-a99c-ce72c79aeb5e`；不能只回一个却声称对齐。
