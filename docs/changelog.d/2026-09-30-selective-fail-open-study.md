## 2026-09-30 · 崩溃时选择性放行：只记录可行性，不装规则

- 归属：不属于 0.0.74 G1–G4，也不属于运维计划任务。设计记录，不改客户行为。
- 来源：基线 `d2363002`；分支 `cursor/selective-fail-open-study-4352`；[#709](https://github.com/raydocs/tono/pull/709)；未合 main。
- 缺陷修复：无。
- 新增/优化：无运行时行为。记录老板提出的「非严格模式下崩溃、卡死或强制门户时放开普通流量、继续挡住 AI」在 macOS PF 与 Windows WFP 上做不到保证。否决 CDN/ASN 拦截和把 `CLAUDE_HOME_DOMAINS` 当作崩溃拦截名单。见 [selective-fail-open.md](../selective-fail-open.md)。
- 工程与测试：仅文档。
- 验证：2026-09-30 在本环境 `dig`：`claude.ai` / `api.anthropic.com` / `claude.com` → `160.79.104.10` 与 AAAA `2607:6bc0::10`；`chatgpt.com`、`api.openai.com`、`grok.com`、`x.ai`、`perplexity.ai` 为 Cloudflare 地址；`gemini.google.com` 为 Google 地址。Anthropic 入站前缀以 https://platform.claude.com/docs/en/api/ip-addresses 为准。未跑产品测试。PF/WFP 未改。
- 候选/发布：仅源码中的文档，无新候选包。
- 剩余限制：真实 IP 在隧道落下且非严格时仍可到达 AI 服务。窄沉洞和 Anthropic 入站前缀阻断都未在本 PR 实现。

## 2026-09-30 · 续记：老板定了可用性优先

- 归属：同上，仍不是 G1–G4。
- 来源：[#709](https://github.com/raydocs/tono/pull/709)。
- 缺陷修复：无。
- 新增/优化：无运行时行为。老板决定改为：非严格模式下崩溃或卡死先完整放行；窄层只作第二层，且不能挡住普通流量或门户登录，恢复网络必须删除它。中国大陆客户直连 AI 本来就不通，不为真实 IP 牺牲上网。CDN/ASN 拦截仍然否决。
- 工程与测试：仅文档。#701、#703 仍开着，实现 PR 堆在它们之上并标明阻塞。
- 验证：未改 PF/WFP。沿用同日 `dig`。
- 候选/发布：无新候选包。
- 剩余限制：窄层做不到「真实 IP 永不到达」。实现未合入，且不能先于 #701、#703。
