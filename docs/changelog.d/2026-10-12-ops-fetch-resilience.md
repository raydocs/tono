## 2026-10-12 · 运维台：后台连不上时的提示、读取自动重试与页面崩溃兜底
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `feat/ops-maturity-r1`（70a474f6，叠在其上，合入顺序：先 feat/ops-maturity-r1）→ 分支 `feat/ops-fetch-resilience`；未合 main。
- 缺陷修复：
  - `getJson` 先看内容类型再看状态码，边缘返回的 HTML 502/503 被当成「登录已过期」；除我们自己的 15 秒超时外，fetch 抛出的浏览器英文错误（Failed to fetch）原样露给页面。
  - 没有任何重试，也没有全局「后台连不上」提示（只有 180 秒后的页眉「后台没响应」）。
  - 渲染报错或懒加载页面块下载失败时整页空白。
- 新增/优化：
  - 新错误类 `BackendUnreachableError`（`kind: timeout | network | server`，可带 `status`），在 `src/lib/api-errors.ts`，`api.ts` 重新导出。分类：我们的超时 →「后台 15 秒没回应」；其他 fetch 抛出 →「连不上后台」；5xx（JSON 或 HTML）→「后台报错 502」；401/403 → 仍是登录已过期；其他非 2xx 的 JSON 仍用信封里的话；只有 2xx 且非 JSON（Cloudflare Access 登录页）才算登录已过期。写请求（`writeJson`）与 `ApiRefusal` 不动。
  - 读请求（仅 GET）遇到 `BackendUnreachableError` 自动重试一次，间隔 1 秒（`readRetry.delayMs`，测试里可改），调用方取消则立即停止；写请求从不重试。
  - 不读的响应体现在会被释放（`response.body.cancel()`），否则浏览器把请求一直挂着，`networkidle` 要等到 15 秒。
  - `useResource` / `useFleet`：刷新遇到连不上时保留上一次的数据（已有行为），并把错误记在状态的 `unreachable` 上；下一次成功即清除。
  - 外壳横幅：任一共享读取（fleet、节点、客户、funnel、事故、发布、health）当前处于连不上时，页眉下显示「连不上后台 · 页面上的数据停在 HH:MM」和「重试」（立即重跑这些读取）；时间取这些失败读取各自最后一次成功的最早时刻，一次都没读到则说「页面还没有读到数据」。所有页面、手机与桌面都有；登录已过期横幅优先，不同时出现；恢复后自动消失。手机上「重试」沿用 `.ops-action` 的 44 px。
  - `ErrorBoundary`（`src/app/ErrorBoundary.tsx`）包住路由页：渲染报错时显示「这页出错了」和「重新载入」；懒加载页面块失败（`Failed to fetch dynamically imported module` / `Importing a module script failed`）先自动整页重载一次（`sessionStorage` 防循环），仍失败才显示该块。换页（含节点/客户详情）时边界重置。
- 工程与测试：`src/lib/api-resilience.test.ts`（分类、重试、写不重试、取消）、`src/lib/use-resource.test.tsx`（保留数据并记录错误、恢复清除）、`src/app/ErrorBoundary.test.tsx`（兜底块、整页重载只一次）、`e2e/resilience.spec.ts`（桌面与 390 px：连不上后保留表格行并出横幅、解除后点重试横幅消失；打开即 502 说连不上而不是登录过期；手机上重试 ≥ 44 px 且横幅不出视口）。
  旧代码上跑 `api-resilience.test.ts`（保留旧 `getJson`，只补两个同名导出）：8 例 5 例失败（HTML 502 仍报登录已过期、fetch 抛出仍是英文原文、超时仍是「载入失败」、503 后不重试、等待重试时取消不生效）。
- 影响：`?fixtures=error` 系列页面现在会出横幅，且每个读取多等 1 秒重试；这些页面的截图基线（`states`、`today` 等的 error 图）会变，本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：重试对所有 `BackendUnreachableError`（含 15 秒超时）一视同仁，最坏一次读取 30 秒才放弃；写请求的网络错误仍是「动作没做成」，不在本次范围。
