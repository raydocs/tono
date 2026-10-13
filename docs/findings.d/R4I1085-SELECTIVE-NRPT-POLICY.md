| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4I1085-SELECTIVE-NRPT-POLICY | 域（组策略）NRPT 规则存在时 Windows 忽略本地 NRPT 存储，选择性 AI DNS hold 的按后缀规则写入成功却不生效，且无任何报告 | in-PR | [#1145](https://github.com/raydocs/tono/issues/1145)，本 PR（`claude/win-nrpt-policy-hold`）；决定 [112](../decisions/112-2026-10-13-selective-hold-under-domain-nrpt-policy.md) | 低·读码（P2，环境相关） | 本 PR 只检测并报告（DNS 状态咨询字段、诊断、Support 行），不改企业策略。缺口本身仍在：该机器上 Anthropic 固定地址段之外的 AI 名称不被 DNS hold 拦住；替代执法机制需产品决定与 Windows 实机；无实机验证 |
