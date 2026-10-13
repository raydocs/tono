## 2026-10-13 · Windows 选择性 AI 阻断：域策略 NRPT 压住本地规则时如实报告
- 归属：SHIP_PLAN §2 item 10 冻结门之外的硬化（P2，环境相关的 AI 阻断缺口，普通上网不受影响）；Windows Service 选择层 + Support 页 DNS 警告行。
- 来源：issue #1145（发现 `R4I1085-SELECTIVE-NRPT-POLICY`）；分支 `claude/win-nrpt-policy-hold`。决定 [112](../decisions/112-2026-10-13-selective-hold-under-domain-nrpt-policy.md)（provisional）。
- 缺陷修复：存在任何域（组策略）NRPT 规则时，Windows 忽略本地 NRPT 存储，选择层写入的按后缀规则成功却不生效，安装器仍报成功。现在写入后读取 DNS 客户端实际应用的 NRPT；没有任何生效规则带选择层的 sinkhole 解析器，就记录 `TONO_DNS_SELECTIVE_POLICY_SUPPRESSED`，`GET /dns/status` 的 `resolver_policy_warning`（咨询字段，不进 `last_error`，不关任何门）在该 hold 存在期间携带它；诊断报告折进 `dnsLastError`，Support 页 DNS 警告行按标记显示。不修改或删除企业策略，不加 catch-all DNS/WFP 阻断，hold 的结果与释放行为不变；读取失败不下结论。该读取在独立观察线程中进行（不占用 hold 工作线程的完成预算，不会把已成功的安装报成失败，也不会拖住之后的移除；带代数的结果在 `remove()` 或重新安装之后到达会被丢弃，且最多一个观察线程）。
- 工程与测试：先红后绿——`domain_nrpt_policy_over_the_ai_hold_is_reported_in_the_dns_status`（`selective_layer.rs`，用不相关域名空间的策略模型，不拿注册表写入成功当证明）；`a_hung_nrpt_read_cannot_fail_the_install_block_the_removal_or_revive_a_warning` 用挂起的读取证明安装结果、移除与过期结果；红分支只含测试加两个空桩，使其编译后在断言处失败。
- 验证：见 PR 正文 `## Verification`；本机不跑 Windows crate 的 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：该机器上域名在 Anthropic 固定地址段之外的 AI 名称仍解析正常（替代执法机制需要产品决定与 Windows 实机验证）；App 主界面没有新增状态位，原因只在 Support/诊断中可见；无实机验证（域策略 NRPT 机器）。
