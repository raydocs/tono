## 2026-10-02 · Windows：连接期间局域网可达（路由器、打印机、NAS、发现）
- 归属：SHIP_PLAN §2 第 10 项；Windows Service（`core/wfp_model.rs`、`core/wfp/mod.rs`）。
- 来源：基线 `cc673eaa` → 分支 `fix/win-lan-while-protected-20261002`，PR #1355；已合入 main（见文末续记）。
- 缺陷修复：连接后同网段的私网、链路本地地址和本地发现（mDNS、SSDP、广播）原先全部被 WFP 兜底阻断。现在 `Locked` 且会话有隧道 LUID 时放行，地址表参照 macOS。两个方向的远端端口 53/853 都不放行，核心进程到这些地址另有阻断（解析不出核心 app id 时放行一并撤掉），`Bootstrap`、`Blocked` 仍全部阻断。所有者决定放行，形状见决策 048。关联 WIN-LAN-BLOCKED-WHILE-PROTECTED。
- 新增/优化：WFP 模型新增远端端口范围条件 `RemotePortRange`；`FILTER_NAMESPACE` 升到 v13（升级时整套规则按新 key 重装）。
- 工程与测试修正：回归 `a_locked_session_reaches_the_lan_but_not_its_dns` 先单独推送为 `da3fc2e2`（红），结果记在 PR。`moving_the_core_binary_rekeys_the_endpoint_permit` 的重装数量从 1 改为 3（多了两条按核心路径取 key 的阻断）。
- 独立评审：Codex `gpt-6.1-sol` high 审了 `df01edcf`，结论和处理记在 PR 评论；修了回退路径和入站端口两条，另两条（私网段不等于在网、规则不跟网卡实时状态）记为已知限制。
- 验证：仅托管 CI（cargo test）；没有 Windows 实机验证，标 needs-hardware。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1355，merge commit `e080d818`，PR 头 `2679713c`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37066758222 。红测试 `da3fc2e2`：run 37064121148（`476 passed; 1 failed`，只有 `a_locked_session_reaches_the_lan_but_not_its_dns` 失败）。
- 独立评审：Codex `gpt-6.1-sol` high 三轮，覆盖到 PR 头 `2679713c`，记录在 https://github.com/raydocs/tono/pull/1355#issuecomment-5961749934 。第 1 轮（`cc673eaa..df01edcf`）4 条按重大报的：两条修了（核心 app id 解析失败时撤掉放行、入站补端口条件），两条（私网不等于在网、规则跟记录的会话走）按所有者「放行局域网」的范围记为已知限制，第 2 轮评审接受为已记录的残余；第 2 轮（`df01edcf..18e44196`）1 条重大（入站规则换条件没换 key）已修；第 3 轮（`18e44196..2679713c`）无重大、无小问题。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证（needs-hardware）。
