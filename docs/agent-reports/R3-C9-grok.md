# R3-C9-grok 控制面 admin / public / preview（2026-10-01）

Fixer: Grok 4.7。范围：`services/control-plane/admin/*`、`public/*`、`preview/*`。非界面缺陷：管理端鉴权缺口、公开静态资源里的密钥或令牌、preview 部署碰到生产数据或绑定、开放重定向、会改状态的管理操作缺 CSRF、未转义数据的 XSS。界面改动不在范围内。基线：`origin/main` `c2626f53`（报告分支基于稍后的 `236d76cd`）。

Sol 的 W1-sol-cp 没有报告可对。`docs/agent-reports/W1_CODEX_STATUS.md` 写明 cloud agent `sol-cp`（bc-d5e5286f）没推出分支就停了；仓库里搜不到 `W1-sol-cp` 报告。已合的 Sol 控制面改动不在这三处目录上。本轮按文件清单自己查。

## 已修

| 项 | PR |
|---|---|
| C9-G-F1 preview 渲染只校验 D1 UUID 形状，不拒绝 `wrangler.jsonc` / `wrangler.admin.jsonc` 里的生产 `database_id`。该 id 会写进 API 与 admin 两份生成配置的 D1 绑定。主机名和 R2 桶名已经拒绝生产值。 | [#959](https://github.com/raydocs/tono/pull/959) |

没有对应的已开 issue。没有 `Fixes #N`。#943 修的是清空脚本和 preview 恢复脚本，不改 `preview/config.mjs`。

## 未修的已证实缺陷

无。请你归档的条目：无。没有新 issue，也没有碰到 403。

## 跳过的重叠

开 PR 前，开着的 PR 里只有 #713 碰到 C9 路径：`admin/src/api.ts`、`admin/src/lib/draft-guard.ts`、`admin/src/pages/ControlPage.tsx` 及其测试。本轮不改这些文件。

## 驳回

| 假设 | 为什么不是缺陷 |
|---|---|
| 管理端 SPA 把 Access 令牌或 `ADMIN_API_TOKEN` 放进浏览器存储 | `localStorage` 只有主题、隐私开关、监控视图、刷新间隔。`sessionStorage` 是操作者自己的目录/策略草稿。API 客户端走同源 cookie。Access JWT 只从 `cf-access-jwt-assertion` 读，不在这三处目录里。 |
| 会改状态的 ops 请求没有 CSRF | 同源 `sec-fetch-site` / `Origin` 检查在 `src/admin-worker.ts`（C5），非 GET/HEAD 的 `/api/v1/ops/` 否则 403。C9 目录里没有第二处放行。 |
| 哈希路由或深链是开放重定向 | `admin/src/lib/hash.ts` 只接受已知页面 id，未知 slug 回到 dashboard。KPI 与事故链接是 `#/...` 常量或本地拼接。`admin-worker` 深链段是 `[A-Za-z0-9_-]+`，被吸收的主机固定跳到 `https://admin.afk.ccwu.cc/ops/#/monitor`。 |
| `billingUrl` 或仪表盘链接是 XSS | 管理端没有 `dangerouslySetInnerHTML` / `innerHTML`。服务端 `httpsUrlField` 要求 `https:`。React 文本节点会转义。 |
| `public/` 里有私钥或第三方令牌 | `latest.json` 的 Tauri 签名和 `appcast.xml` 的 `edSignature` 是公开签名。没有私钥块、`sk_live`、`ghp_`。安装包地址在 `releases.afk.ccwu.cc`。静态 HTML 不回显查询参数。 |
| preview 种子或合成目录带了客户数据 | 邮箱是 `example.test` / `example.com`（保留域）。地址是文档用网段。`render-config.mjs` 只收四个环境变量，服务绑定写死 `tono-control-plane-ops-preview`。 |
| 全零 UUID 或生产主机名还能渲染 | 这两项已经拒绝。本轮只补生产 D1 id。 |

## 验证

- Node v22.22.2 / Linux。修复前渲染器接受大写生产 id，两份配置的 `database_id` 都是该生产 id。修复后抛出 `must not be the production D1 database`。`npx vitest run test/preview-config.test.mjs`：4 passed。
- 本机没有 Node 24。未对远程 D1 执行。未部署。

## 合并

[#959](https://github.com/raydocs/tono/pull/959) 等 `ci-gate` 绿了再开一次 auto-merge（merge commit）。若队列管理把它关掉，不再打开。本报告 PR 不开 auto-merge。
