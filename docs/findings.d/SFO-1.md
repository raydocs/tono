| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SFO-1 | 崩溃或强制门户时，PF/WFP 无法在不误伤全网的前提下保证真实 IP 到不了 AI 服务 | accepted-design | [#709](https://github.com/raydocs/tono/pull/709) | 高·推导 | 老板决定可用性优先：非严格崩溃先完整放行。窄层（第一方后缀沉洞 + Anthropic 入站 `160.79.104.0/23` 与 `2607:6bc0::/48`）只作第二层，实现在 [#738](https://github.com/raydocs/tono/pull/738)，被 #701 和 #703 挡住。不能挡普通流量或门户，恢复网络必须删除。CDN/ASN 仍否决。ChatGPT 等在 Cloudflare 或 Google 上；DoH、缓存、IP 字面量、非系统解析器都会漏。详见 [selective-fail-open.md](../selective-fail-open.md) |

2026-09-30 研究。老板决定可用性优先，并要求实现那一层很窄的第二层。[#738](https://github.com/raydocs/tono/pull/738) 做这件事，不能先于 #701 和 #703。状态仍是取舍：窄层做不到「真实 IP 永不到达」，不是待修缺陷。
