## 2026-10-01 · preview 渲染拒绝生产 D1 id
- 归属：ops plan（preview 隔离）；控制面 preview 配置渲染。不改客户通道。
- 来源：origin/main c2626f53 → cursor/preview-d1-production-id-f6c6；PR 待开；未合 main。
- 缺陷修复：C9-G-F1。渲染器接受任意非全零 UUID，包括 `wrangler.jsonc` / `wrangler.admin.jsonc` 里的生产 database_id，两份生成配置都会绑上生产库。现在该 id（大小写不敏感）在替换占位符之前被拒绝。
- 新增/优化：无。
- 工程与测试：`services/control-plane/test/preview-config.test.mjs` 在原有拒绝用例里加一条大写生产 id。
- 验证：待跑 `npx vitest run test/preview-config.test.mjs`（Linux / Node）。未对远程 D1 执行。未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：生产 database_id 轮换后须同步 `productionDatabaseIds`。别的已存在库 id 仍会被接受。
