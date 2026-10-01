## 2026-09-30 · Windows 签名办公软件直连不再盖住助手域名
- 归属：SHIP_PLAN §2 第 10 项（连上后 AI 流量可从物理网卡出去）；影响 Windows mihomo 运行时与 DIRECT 图校验。
- 来源：main `ff81118a` → 分支 `hunt/grok-winapp-ai-direct-2a89`；PR 待开；未合 main。
- 缺陷修复：目录没有住宅跳、且已提交签名微信/钉钉/飞书路径直连时，助手域名与 Anthropic 网段先于无地址端口规则指向 `Tono-Exit`。控制器读回按同一顺序校验，缺这些行则拒绝该 DIRECT 图。关联 `WIN-WECHAT-AI-DIRECT`。
- 新增/优化：无。签名路径上的原始 CDN IP 直连保留。
- 工程与测试：tono-core 一条规则顺序回归；App 一条控制器图回归。
- 验证：本机 rustc 1.83，crate 要求 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。未做实机抓包。
- 候选/发布：仅源码，无新候选。
- 剩余限制：签名进程用 HTTPDNS 直拨 Anthropic 段以外的原始 IP 仍命中无地址端口规则。needs-hardware。
