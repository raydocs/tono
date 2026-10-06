## 2026-10-06 · Windows 新外观 PR 6：登录与三幕介绍
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §8；默认关闭，stacked on #1408。
- 来源：`5d988dfa` → 本 PR head，`codex/windows-ui-pr6-20261006`；未合 main。
- 缺陷修复：没有新增已发布产品缺陷；开发期截图发现介绍 chip 漏插值、错误动画重挂载输入失焦，已消除，未伪装成已发布故障。
- 新增/优化：夜景登录，44px 标题、280px 邮箱与 pill；一个真实验证码输入上六个装饰格，粘贴净化后走现有六位自动提交/请求互斥。仅新外观在明确 `TONO_AUTH_INVALID_CODE` 后清空并一次摇动装饰格；真实输入不重挂载，不自动重试。保护拦截/未确认/旧隧道恢复卡沿用证据和处理函数，海景 failed。暂停/会话失效、恢复失败、客服摘要/换邮箱/60s重发/10分钟提示均保留。
- 介绍：三幕真实场景 connected/failed/idle、pager、下一步/跳过/左右键/Esc；教育场景不是保护状态或真实连接操作。保留原文第二句，不把草稿擅自定稿。最后仍写 once marker 并去 `/login`，不是未认证首页：ROUND-3 行为优先，auth guard 没有绕过。
- 工程与测试：模拟 shell 加登录/介绍及合成账户/恢复状态，禁止 IPC；新增粘贴一次、明确错误清空且不失焦、三幕结束仍登录的各一个回归。原登录/客服恢复测试不改期望。
- 验证：MacBook窄3files17tests PASS；typecheck79/baseline79；Vite build1.05s；修改代码ESLint0warnings，Biome无error（旧测试5个非空断言warning未改）；最终全套结果与截图在PR comment。实际browser one input/six boxes，保护拦截/未确认/旧隧道场景均failed；介绍结束marker=1并登录。无Windows原生/真实邮件/读屏器验收。
- 候选/发布：仅源码，无新包、签名、安装或客户发布。
- 剩余限制：截图使用静态质量和合成数据；真实场景过渡录像、Windows硬件/字体、旧外观像素对照未运行；PR7–10未交付。认证相关改动若并入发布仍需按仓库规则记录适用的独立审查覆盖。
