## 2026-09-30 · Windows 签名办公软件直连不再盖住助手域名
- 归属：SHIP_PLAN §2 第 10 项（连上后 AI 流量可从物理网卡出去）；影响 Windows mihomo 运行时与 DIRECT 图校验。
- 来源：main `ff81118a` → `c284deaa`；分支 `hunt/grok-winapp-ai-direct-2a89`；PR #871；未合 main。
- 缺陷修复：目录没有住宅跳、且已提交签名微信/钉钉/飞书路径直连时，助手域名与 Anthropic 网段先于无地址端口规则指向 `Tono-Exit`。控制器读回按同一顺序校验，缺这些行则拒绝该 DIRECT 图。关联 `WIN-WECHAT-AI-DIRECT`。
- 新增/优化：无。签名路径上的原始 CDN IP 直连保留。
- 工程与测试：tono-core 一条规则顺序回归；App 一条控制器图回归。
- 验证：本机 rustc 1.83，crate 要求 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。未做实机抓包。
- 候选/发布：仅源码，无新候选。
- 剩余限制：签名进程用 HTTPDNS 直拨 Anthropic 段以外的原始 IP 仍命中无地址端口规则。needs-hardware。

## 2026-10-01 · 续记：规则顺序测试不再借用已释放的 YAML

- 归属：同一修复 #871。已把 `origin/main` `78afd4d7` 合并进分支，无冲突。
- 来源：`windows / core` 与 `windows / app-rust` 都在编译 `tono-core` 测试时失败，不是断言失败。
- 缺陷修复：无行为变化。
- 工程与测试：`assistant_hosts_precede_address_free_signed_app_direct_without_a_home_hop` 把 `parsed(&runtime)` 放进临时值，再把规则字符串收成 `Vec<&str>`。新 rustc 报 E0716（临时值在借用仍在时被释放）。改为与相邻测试一样先绑定 `parsed_runtime`。
- 验证：本机 rustc 1.83 仍不能编译 edition 2024，`cargo test` 未跑。由 Windows CI 复跑。
- 候选/发布：仅源码，无新候选。
