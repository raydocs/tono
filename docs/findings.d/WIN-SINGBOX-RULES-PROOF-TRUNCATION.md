| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-RULES-PROOF-TRUNCATION | Windows sing-box 直连重载的 `/rules` 校验把 `process_name` 等完整列表预测成前 3 项：绑了家宽（AI 进程规则 19 个进程名）时直连永远装不上，微信与国内网站一直走云节点 | in-PR | [#1684](https://github.com/raydocs/tono/issues/1684) / [#1685](https://github.com/raydocs/tono/pull/1685) | 中·实测 | 未泄漏：失败回到全隧道。实测为客户 0.0.77 日志与本机 alpha.9 复现；修复后的 Windows 实机直连未验证 |
