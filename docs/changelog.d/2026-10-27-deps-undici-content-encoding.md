## 2026-10-27 · undici 升到已修补版本（content-encoding DoS 告警）
- 归属：运维计划（依赖安全）；`services/control-plane`（开发依赖）与 `apps/windows/app`（开发依赖）的锁文件。
- 来源：分支 `amp/deps-undici-7.30.1`（基线 origin/main）；未合 main。
- 缺陷修复：Dependabot 高危告警「undici vulnerable to Denial of Service via unhandled error on excessive content-encodings」。控制面：沿用 `dd736d5e8` 的作用域 override，把 `@cloudflare/vitest-plugin` 子树的 undici 从 7.29.1 提到 7.30.1（miniflare 精确钉版本，只能这样抬）。Windows 前端：`pnpm update undici --lockfile-only`，`@actions/http-client` 下 6.29.0 → 6.29.1，jsdom 下 8.12.2 → 8.12.3；范围内补丁升级，`package.json` 不变。
- 新增/优化：无。Worker 包与 Windows 产品包都不含 undici（均为开发/发布脚本依赖）。
- 验证：控制面 `npm test` 74 个文件 1102 个测试通过；Windows 前端 `pnpm install --frozen-lockfile` 通过，40 个 jsdom 测试文件 302 个测试通过，`@actions/github` 可加载，`pnpm audit --prod` 无已知漏洞。未跑：使用 `@actions/github` 的发布脚本（需发布环境）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`services/control-plane/pnpm-lock.yaml`（及 `services/ops-console/pnpm-lock.yaml`）随 `d13e05970` 误入仓库，服务用 npm，无工作流读取；其中的 undici 7.29.1 告警（#83）留给该文件的去留决定，本 PR 不动。
