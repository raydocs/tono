## 2026-10-12 · Mac PF：每份规则集都放行 DHCP 与邻居发现（换 Wi‑Fi 后无法上网）
- 归属：SHIP_PLAN §2 item 10「连不上且无下一手」；macOS helper。
- 来源：基线 `fd438f627` → 分支 `claude/wifi-switch-mac-pf-dhcp`，PR #1591（草稿，未合 main）。
- 缺陷修复：旧版 `renderRules` 只在有隧道（`tunnelInterfaces` 非空）时才写 `tono-dhcp`（255.255.255.255:67 广播 DHCP）和 `tono-ndp`（IPv6 邻居发现，icmp6 133–137）。每一份无隧道规则集（连接开始的 bootstrap、换网络时的 preserve 拆除、`reassertIfNeeded`、helper 的紧急阻断）因此以 `block drop out quick all` 收尾，没有 DHCP/NDP 放行。换 Wi‑Fi（手机热点到酒店/办公室）后 Mac 正处于这种状态，可能拿不到新网络的租约，`NetworkUplinkSnapshot.classify` 只读到 `.inconclusive`，不触发 `.moved` 重连，用户只能卸载 Tono 才能上网。改后：这两组放行出现在 `renderRules` 产生的每一份规则集里，文本不变，位置仍在 `block drop out quick all` 与物理接口 DNS 阻断之前。有隧道的规则集逐字节不变。
- 新增/优化：与 Windows `intent_floor`（每个武装模式都放行 DHCPv4/DHCPv6/NDP）对齐；范围和理由见决策 097。mDNS、IGMP、Continuity、`tono-lan`、link-local 仍只在有隧道时渲染，仍受“允许本地网络设备”开关控制，没有改动。
- 工程与测试：新增一条 helper 自测 `runNoTunnelDHCPNDPSelfTest`（无隧道规则集渲染两条 `tono-dhcp` 与两条 `tono-ndp`，且都在最终 block 之前）。更新两条原来断言“无隧道时没有 DHCP/NDP”的旧断言：`tunnelOnlyLabels`（boot restore 无隧道形态）不再含 `tono-dhcp`/`tono-ndp`，`emergencyExpected`（紧急规则集整串比较）加入这四行。Helper 版本 4.52.51 → 4.52.52，`CONTRACT.sha256` 重新计算（构建门要求：PF 渲染变了必须升版，否则已安装的旧 daemon 永远不会更新）。协议（IPC）本身未变。
- 验证：本机按 AGENTS.md 不运行 swift/xcodebuild。红提交（只加新自测与版本号）与绿提交（修复）各由托管 CI 的 `ci-gate` 判定，结果记在 PR #1591 正文。未执行：任何真机测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：待实机：换 Wi‑Fi 后能否取得租约。需要独立 Codex 审查（PF fail-closed 变更）后才能合并。DHCPv6（546/547）本次不改；无隧道时 DHCPv6 与单播续租仍落到最终 block。
