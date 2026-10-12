## 2026-10-10 · Windows 登录失败文案：说清卡在哪、怎么办；保护拦网时说清登录要关保护及其影响
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）检查项 3、4；`apps/windows/app/src/locales/{en,zh}/tono.json`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-login-recovery-copy`，PR [#1530](https://github.com/raydocs/tono/pull/1530)；未合 main。
- 缺陷修复（[WIN-LOGIN-COPY-NO-HINT](../findings.d/WIN-LOGIN-COPY-NO-HINT.md)）：
  - `login.errors`：连不上登录服务器（`TONO_AUTH_DNS/TCP/TLS/TIMEOUT/QUIC/UNREACHABLE/LOCAL_CONFLICT`）改为说明是这个网络连不上 Tono 登录服务器、确认能上网、等一分钟重试、一直失败复制详情给客服；
    设备数满、时钟不对（en/zh）及英文验证码过期、保存失败、服务繁忙补回可操作的说明（中文已有的三条不动）。支持码照旧附在句末。
  - `login.restoreFailed`：标题「登录状态已失效 / Session expired」改为「没能恢复登录 / Couldn't restore your sign-in」，说明可能是网络连不上服务器，先重试再重新登录。
  - `login.networkBlocked.description` / `unverifiedDescription`：说明防泄漏拦住了网络（包括 Tono 中继，WFP 只放行 Cloudflare 固定地址），要登录须点「恢复网络」，这会关闭保护，重新连接前流量直接出网、不经过 Tono。保护照旧只在用户点按钮时释放。
- 新增/优化：无新键、无视觉改动；不重复草稿 #1478 的路径面板。
- 工程与测试：`login.test.tsx` 新 `it`「says signing in needs protection off and what that does, and releases only on the explicit button」：
  保护拦网时说明文案含中继、关闭保护和影响，发送验证码禁用，只有点「Restore network」才调用断开。旧文案下该用例失败（已验证）。
- 验证：Linux orb，Node 24，pnpm 11.26.0：`npx vitest run src/pages/tono/login.test.tsx src/pages/tono/login-support.test.tsx` 16 passed；`pnpm test` 400 passed；`pnpm typecheck` 通过。
- 候选/发布：仅源码，无新候选。
- 剩余限制：恢复失败卡片不区分具体原因；armed 时中继不可达本身是放行表决定（decision 077），未改。
