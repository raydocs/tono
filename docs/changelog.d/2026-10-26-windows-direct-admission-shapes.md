## 2026-10-26 · Windows Service 拒绝过宽的 DIRECT 准入形状（#1280 第一步）
- 归属：G2（Windows 客户端）；模块 `apps/windows/service`（`src/core/direct_admission.rs`）。
- 来源：基线 main `29384fc48` → 分支 `fix/windows-direct-admission-shapes`，一个提交（标题以 “Refuse catch-all DIRECT admission shapes (first step for #1280)” 开头）。未推送，未开 PR，未合 main。
- 缺陷修复：基线 main 上进程正则（`regex_ok`）与域名（`host_ok`）已按编译器形状判定，裸 `^`、`^.*`、单标签 `com` 已被拒绝（`7020db744` 还把 sing-box 规则绑定到已验签流量策略）；仍然漏过的是 /32 固定地址：`pin_ok` 只排除 1.1.1.1、8.8.8.8 和 Anthropic 段，`0.0.0.0/32`、回环、链路本地、组播、广播 /32 都能通过形状检查（mihomo 与 sing-box 共用）。现在 `pin_ok` 一并拒绝这五类。
- 新增/优化：sing-box 的 DIRECT 规则被拒时，错误文本在 “is not a compiler shape” 后带上具体原因，审计/日志可看出是哪条规则拒绝：`process pattern has no literal text`（`^`、`^.*`、`^.+`、`^(.*)`、`^[^\\]*`、`^(?s).*` 等，“字面字符”指正则元字符 `.*+?()[]{}|\^$` 以外的字符，转义如 `\.` 算字面，取反字符类不算）、`process pattern is not a compiler path regex`、`domain is a wildcard, empty label, single label or protected host`、`address is not one routable /32 (...)`，其余为 `rule keys, ports, outbound or pins are not a compiler shape`。原因文本只用于诊断，准入判定仍由原有函数决定，不放宽任何形状。IPC 契约、处理器、编译器形状均未改。mihomo 路径的错误文本未加原因（沿用原文本），但共用 `pin_ok` 的新拒绝。
- 工程与测试：新增 `a_non_routable_pin_is_not_a_compiler_shape`、`a_process_pattern_refusal_names_its_rule`、`literal_text_is_counted_outside_metacharacters_and_negated_classes`，并扩充 `a_catch_all_domain_is_not_a_compiler_shape`（`""`、`*`、`*.qq.com`、空标签、全数字末标签）。
- 验证：本机 macOS，`apps/windows/service` 下 `cargo +1.98.1 test --locked --features standalone,client,test direct_admission`：10 通过（原 7）。未运行 Windows CI（`windows / service`）。新测试对旧代码失败这一点未单独运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：#1280 未关闭。公共后缀单独出现（如 `com.cn`）无法拒绝：Service 内没有公共后缀表，仍按多标签主机放行。完整修复（Service 自己验证已签名策略并逐条核对 DIRECT 规则条目、域名与进程范围）需要所有者做设计决定，仍开在 #1280；本条目不能声称已关闭 #1280，也不能声称 IPC 调用方无法把任意已审端口流量送去 DIRECT。
