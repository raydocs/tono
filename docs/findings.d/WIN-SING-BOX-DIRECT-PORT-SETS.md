| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SING-BOX-DIRECT-PORT-SETS | Windows sing-box DIRECT：App 的复核端口 [80,443,8000,8080] 与编译器集合 {80,443,8080,8443} 不一致，真实计划几乎不能编译；编译拒绝可能表现为阶段错误而非跳过覆盖层 | in-PR | [#1247](https://github.com/raydocs/tono/issues/1247)，本 PR（`claude/win-direct-admission`） | 低·已确认（P2，无泄露） | 修复：sing-box 计划改用编译器集合，向 Service 只提交集合内端口，编译拒绝按可选覆盖层跳过（回归 `a_sing_box_compile_refusal_skips_the_overlay_and_keeps_the_exit`）；需 Windows 实机确认阶段结果 |
