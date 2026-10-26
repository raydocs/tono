| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-AUTH-RATELIMIT-SHARED-RELAY-IP | TLS 中继用户共用登录 IP 限流桶，单个用户能阻断其他账户登录 | in-PR | 本 PR · fix/t6-control-plane | 高·已确认（本地 D1 回归） | 精确匹配 Cloudflare 源 IP，不支持任意代理/ASN；真实中继登录未验；每邮箱全局限额保留（仍可能被针对邮箱耗尽） |

证据：基线 `login.ts:23-26,49-53,65-69`。修复 `services/control-plane/src/login.ts:23,34,59,77`：TLS 透传无可信 forwarded ID；只对精确已配置的 relay 源 IP 免除共享 IP 桶，保持全局邮箱、challenge 和 installation 限额与数据库 OTP attempts 上限，不接受自报身份。直连仍有原 IP 限额。
RED：`fc2fbc0fb` 三项失败；GREEN：`cd7b590f3` 四项通过，包括转发头伪造不能绕过直连限额；见 [验证记录](../reports/t6-control-plane-verification-2026-10-24.md)。
