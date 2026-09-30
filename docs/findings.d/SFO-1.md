| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SFO-1 | 崩溃或强制门户时，PF/WFP 无法在不误伤全网的前提下保证真实 IP 到不了 AI 服务 | accepted-design | [#709](https://github.com/raydocs/tono/pull/709) | 高·推导 | 老板决定可用性优先：非严格崩溃先完整放行。窄层（第一方后缀沉洞 + Anthropic 入站 `160.79.104.0/23` 与 `2607:6bc0::/48`）只作第二层，不能挡普通流量或门户，恢复网络必须删除。CDN/ASN 仍否决。ChatGPT 等在 Cloudflare 或 Google 上；DoH、缓存、IP 字面量、非系统解析器都会漏。详见 [selective-fail-open.md](../selective-fail-open.md) |

2026-09-30 研究。老板要求选择性放行。代理选择不实现活规则，因为那会把无关站点和门户登录一起阻断，或留下 #701 还不会删除的解析黑洞。状态是取舍，不是待修缺陷。
