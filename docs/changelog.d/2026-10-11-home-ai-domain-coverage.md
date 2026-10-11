## 2026-10-11 · 补齐 owner 指定的 Home AI 域名
- 归属：SHIP_PLAN G1/G2 下一版路由覆盖；不进入 0.0.75 G4 冻结候选，不恢复 A13 / #1504，不实现 #1571 默认 DIRECT 实验模式。
- 来源：基线 [main a8b0be2d5701dbabdb644699547398bdefb99a26](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26)；分支 `fix/home-ai-domain-coverage`，准确提交/PR 与验证回执见交付 PR；未合 main。
- 缺陷修复：owner 清单和截图对应的 51 个具体目标中，17 个已有覆盖，34 个缺失。两端 Home 后缀表同步由 84 项增至 118 项；保留既有条目与优先级，不将未匹中流量改为 DIRECT。
- 新增/优化：补 g.ai、Dify、Poe、Groq、Sora、Cursor、Jasper、OpenArt、Clipdrop、chatgpt.site、OpenRouter，以及指定 Google AI、GitHub/JetBrains API、Cloudflare AI Gateway、Fathom 主机。具体主机沿用 DOMAIN-SUFFIX，涵盖该主机及子域，不扩成 google.com/googleapis.com/github.com 等共享父域；api.github.com 的非 AI API 请求同样走 Home，这是名单选择的影响，不是应用识别。
- 工程与测试：扩展既有 Mac sing-box 产品配置 XCTest 和 Windows Home 配置回归，检查独立列出的缺项确实生成 TCP Home/UDP 拒绝规则、位于 DIRECT 前，且不加入共享父域。现有 Home 表继续参与两端 DIRECT 禁止集及 Windows Service 准入；无新接口、协议版本、进程匹配或 PF/WFP 改动。
- 验证：Linux orb 的源码覆盖/两端一致性、签名策略合同与 diff 检查见准确 head PR 回执；原生测试由正常 PR CI 在指定宿主运行，具体通过/失败/pending 以回执为准。未执行设备、抓包、DNS 泄露或第三方账户实验，不将配置测试当作端到端安全证明。
- 候选/发布：仅源码，无新候选、nightly、合并、部署或客户发布；保持 #1571 设计 PR 独立与 A13 暂停。
- 剩余限制：已有 Claude/ChatGPT/Codex/Cursor/VS Code/Grok 等进程名和安装路径匹配，但不等于不可伪造身份或任意客户端全覆盖；共享 node/python 不整体捕获。截图目录应使用路径匹配而非 PROCESS-NAME；clau.de 已有，IPv4 /23 已被 /21 覆盖，IPv6 仍禁用。未添加泛化 openai 关键词或 HTTPS URL-REGEX；其明确的 alkali 主机按后缀覆盖，Gemini 主机已覆盖，不能按加密 URL 的查询参数识别 google.com 请求。路由名单不背书第三方域名归属，也不新增 Home 第二跳 DNS 或持续无泄露保证。
