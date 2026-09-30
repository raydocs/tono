## 2026-09-30 · 崩溃时选择性放行：只记录可行性，不装规则

- 归属：不属于 0.0.74 G1–G4，也不属于运维计划任务。设计记录，不改客户行为。
- 来源：基线 `d2363002`；分支 `cursor/selective-fail-open-study-4352`；[#709](https://github.com/raydocs/tono/pull/709)；未合 main。
- 缺陷修复：无。
- 新增/优化：无运行时行为。记录老板提出的「非严格模式下崩溃、卡死或强制门户时放开普通流量、继续挡住 AI」在 macOS PF 与 Windows WFP 上做不到保证。否决 CDN/ASN 拦截和把 `CLAUDE_HOME_DOMAINS` 当作崩溃拦截名单。见 [selective-fail-open.md](../selective-fail-open.md)。
- 工程与测试：仅文档。
- 验证：2026-09-30 在本环境 `dig`：`claude.ai` / `api.anthropic.com` / `claude.com` → `160.79.104.10` 与 AAAA `2607:6bc0::10`；`chatgpt.com`、`api.openai.com`、`grok.com`、`x.ai`、`perplexity.ai` 为 Cloudflare 地址；`gemini.google.com` 为 Google 地址。Anthropic 入站前缀以 https://platform.claude.com/docs/en/api/ip-addresses 为准。未跑产品测试。PF/WFP 未改。
- 候选/发布：仅源码中的文档，无新候选包。
- 剩余限制：真实 IP 在隧道落下且非严格时仍可到达 AI 服务。窄沉洞和 Anthropic 入站前缀阻断都未实现，要等 #701 与 #703 合入并且紧急解除能删除这些规则。需要实机才能证明沉洞不会在安全模式里留下来。
