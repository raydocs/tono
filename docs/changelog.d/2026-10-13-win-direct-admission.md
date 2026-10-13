## 2026-10-13 · Windows sing-box DIRECT：准入拒绝过宽形状；端口集与编译拒绝改为跳过覆盖层
- 归属：SHIP_PLAN §2 item 10 的冻结门之外的硬化（P2，无泄露面扩大）；Windows Service 准入 + App sing-box DIRECT 阶段。
- 来源：issue #1280、#1247；分支 `claude/win-direct-admission`。决定 [110](../decisions/110-2026-10-13-sing-box-direct-admission-shape-limits.md)（provisional）。
- 缺陷修复（#1280，窄步）：`direct_admission.rs` 的 `regex_ok` 原来只要求以 `^` 开头，裸 `^`、`^.*` 在 AI 固定规则就位后即被放行，等于所有进程的复核端口流量送往 DIRECT；现仅放行 `tono-core` `windows_path_regex` 的写法且字面字符不少于 12 个。`host_ok` 现要求带点且末段非纯数字（拒绝 `com`、地址）。完整方案（Service 自己验签并只放行策略列出的条目）需要协议版本、Service 内的策略公钥与解码器，本 PR 未做，作为 open 发现 `WIN-SING-BOX-DIRECT-SIGNED-POLICY-BINDING` 保留。
- 缺陷修复（#1247）：sing-box 阶段把计划的复核端口换成编译器集合 `{80,443,8080,8443}`（不放宽编译器，也不改 `SING_BOX_PROCESS_PORTS`），向 Service 只提交该集合内的端口（Service 仍只保留自己的 `REVIEWED_DIRECT_PORTS`，8443 不会成为 WFP 许可，8000 对 sing-box 不再请求）；原先 App 带 8000 使编译器拒绝几乎所有真实计划。DIRECT 覆盖层的编译拒绝（含 `expected_clash_api_rules`）现在是 `skip_optional_direct_policy`（连接留在出口），不再是 `StageFailure::error`。
- 工程与测试：先红后绿——`a_catch_all_process_regex_is_not_a_compiler_shape`、`a_catch_all_domain_is_not_a_compiler_shape`（`direct_admission.rs`）、`the_apps_reviewed_ports_reach_the_sing_box_compiler`、`a_sing_box_compile_refusal_skips_the_overlay_and_keeps_the_exit`（`direct.rs`）。红的运行 id 见 PR 正文。
- 验证：见 PR 正文 `## Verification`；本机只把准入模块单独编译跑了两个准入测试（旧代码红、新代码绿），App 测试与整个 Service/Tauri 构建只在 CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：准入仍是形状检查，未绑定签名策略；未在 Windows 实机确认 sing-box DIRECT 阶段结果。
