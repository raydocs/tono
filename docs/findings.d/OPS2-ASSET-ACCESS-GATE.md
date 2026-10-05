| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS2-ASSET-ACCESS-GATE | /ops2 静态资产未进入 Worker 对 /ops 已有的 Access admin 校验与 UI CSP 分支 | in-PR | [#1377](https://github.com/raydocs/tono/pull/1377) | 低·已确认 | 本分支统一两条 UI 路径的校验/CSP；最窄回归验证匿名 401、非 admin 403。仅静态资产边界，未发现管理 API 鉴权放宽或私有数据泄漏；不声称线上 Access 边缘策略失效。未合 main、未部署。 |

基线 c271fe13 的 `src/index.ts` 将 `/ops2/` 送入通用 ASSETS 分支；管理 API 始终有原鉴权。本次不改变 Access 的身份/配置或写权限。证据见[收敛记录](../ops/console-consolidation-2026-10-04.md)。
