## 2026-10-05 · 唯一后台正式改名 ops
- 归属：运维计划 §6 后台收敛；控制面/Admin 与 ops-console。
- 来源：基线 `f693ef02` → `ops/canonical-name-20261005`；尚未合 main/部署。
- 缺陷修复：无新增产品缺陷；这是所有者要求的命名收口。
- 新增/优化：正式入口 `/ops/`；`/ops2/`、`/ops2/index.html`、旧根与旧路径页面兼容跳转，保留 query/fragment。旧专属 hash 自动迁移；新版节点页/对象、客户搜索、用量窗口不套用 ops1 解析。吸收域名与告警入口同步改名。
- 工程与测试：构建 base/outDir、theme-init、预算与既有 E2E URL 改为 ops；成功构建后仅清除 ignored `public/ops2`，无新增 UI 测试/E2E case 或截图基线。
- 验证：MacBook 窄 Worker检查原始 `Test Files 1 passed / Tests 5 passed | 202 skipped (207)`；预算测试 `1 passed / 3 passed`；构建 `initial JS 204.7 KB / total JS 317.2 KB / all budgets green`，`canonical ops index exists`、`retired ops2 output absent`。两服务 typecheck 与 console lint 退出 0；Worker 现有路由文件 `1 passed / 207 passed`、console `44 passed / 345 passed`。实际旧 Git 模块在 unmarked 旧用户书签上不迁移，当前模块迁移通过；真实 Vite SSR + jsdom 检查 canonical 无循环、alias/query/hash/编码对象、旧用户/用量/搜索/分流与新版节点/抽屉/对象/窗口通过（原始工件 `/tmp/tono-ops-name-20261005`）。独立路由审查、精确 head CI 待完成。
- 候选/发布：无客户包、无客户更新源变更、无新迁移/数据写入；当前仅源码。
- 剩余限制：旧 unmarked `#/nodes` 与新版节点页同 URL，选择新版；旧根/路径或 `legacy=ops1` 的旧 nodes 别名仍到目录。生产登录后人工页面验收未执行；浏览器由所有者控制，不夺回。
