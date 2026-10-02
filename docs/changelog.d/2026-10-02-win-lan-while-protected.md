## 2026-10-02 · Windows：连接期间局域网可达（路由器、打印机、NAS、发现）
- 归属：SHIP_PLAN §2 第 10 项；Windows Service（`core/wfp_model.rs`、`core/wfp/mod.rs`）。
- 来源：基线 `cc673eaa` → 分支 `fix/win-lan-while-protected-20261002`，PR #1355；尚未合入 main。
- 缺陷修复：连接后同网段的私网、链路本地地址和本地发现（mDNS、SSDP、广播）原先全部被 WFP 兜底阻断。现在 `Locked` 且隧道存在时放行，和 macOS 一致。局域网 DNS（53/853）仍不放行，核心进程仍到不了局域网，没有隧道时仍全部阻断。所有者决定放行，形状见决策 048。关联 WIN-LAN-BLOCKED-WHILE-PROTECTED。
- 新增/优化：WFP 模型新增远端端口范围条件 `RemotePortRange`；`FILTER_NAMESPACE` 升到 v13（升级时整套规则按新 key 重装）。
- 工程与测试修正：回归 `a_locked_session_reaches_the_lan_but_not_its_dns` 先单独推送为 `da3fc2e2`（红），结果记在 PR。`moving_the_core_binary_rekeys_the_endpoint_permit` 的重装数量从 1 改为 3（多了两条按核心路径取 key 的阻断）。
- 验证：仅托管 CI（cargo test）；没有 Windows 实机验证，标 needs-hardware。仅源码，无新候选。
