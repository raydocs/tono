## 2026-10-12 · control-plane 测试改用 @cloudflare/vitest-plugin，升到 vitest 5
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（依赖维护；不是 ship gate）。
- 缺陷修复：无。
- 新增/优化：无产品行为变化。
- 工程与测试修正：
  - `@cloudflare/vitest-pool-workers@0.23.0` 已在 npm 标为停更（改名为 `@cloudflare/vitest-plugin`），其 peer 只到 vitest 4，
    所以 #1574 只能把 vitest 钉在 4.1.11。换成继任包 `@cloudflare/vitest-plugin@1.4.0`（peer `vitest ^4.1.0 || ^5.0.0`），
    同时把 `vitest` 与 `@vitest/coverage-istanbul` 升到 5.0.3。改动只有依赖名、`vitest.config.ts` 的 import 与 `tsconfig.json` 的 types；
    `cloudflareTest()`、`readD1Migrations()` 与 `maxWorkers: 1`（D1 隔离）不变；出站 mock 是 `vi.spyOn(globalThis, 'fetch')`，不受旧 fetchMock 迁移影响。
    `undici` 7.29.1 的 override 改挂在新包名下（miniflare 同版本）。锁文件用 npm 11 重新生成。
  - dependabot：ops-console 与 Windows 前端忽略 TypeScript 主版本升级。typescript-eslint 最新版与 canary 只支持 TS < 6.1，TS 7 会让 lint 起不来；
    次版本与补丁照常更新。所有者 2026-10-12 决定不为此上 TS 6/7 并排安装，等 typescript-eslint 支持 TS 7 再换。
- 验证（Linux，Node 22，npm 11）：`npm test`（vitest run --coverage）64 文件 1019 个测试全部通过，覆盖率门槛通过
  （auth 93.93 行/87.8 分支，sessions 96.55/87.87，ledger 97.27/80.95，quota 89.59/82.12）。
- 候选/发布：仅源码，无新候选；不部署。
