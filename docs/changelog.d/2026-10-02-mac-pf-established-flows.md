## 2026-10-02 · macOS：武装 Kill Switch 不再丢掉已建立的本机和局域网 TCP 连接
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。macOS helper（Kill Switch PF 规则）。
- 来源：叠在 [#1330](https://github.com/raydocs/tono/pull/1330) 上，分支 `fix/mac-pf-established-flows`，[#1331](https://github.com/raydocs/tono/pull/1331)。未合 main。
- 缺陷修复：有状态的 `pass` 规则默认 `flags S/SA`，只有 SYN 能建状态（`man pf.conf`）。武装之前就存在的 TCP 连接、或状态被整表清掉的连接，后续的包不带 SYN，匹配不到 `tono-loopback`、`tono-lan`、`tono-linklocal` 的出站放行，落到末尾的 `block drop out`，没有 RST，一直卡到应用自己超时。受影响的是规则本来就允许的目的地：本机回环、私网、链路本地（接力和通用剪贴板在同一 Wi-Fi 上的长连接、投屏流、SMB、到局域网的 SSH、本机服务之间的连接）。现在这四条出站放行改为 `no state`，按接口或目的地址逐包放行。入站放行不变。
- 新增/优化：无。
- 工程与测试：helper self-test 新增两条断言（四条出站规则是 `no state`，无隧道时回环那条也在；两条 `tono-lan-fragment` 丢弃规则排在这些放行之前，无隧道时不出现）；原有两处回环规则的期望文本同步。helper `4.52.37` → `4.52.38`，`CONTRACT.sha256` 同步。
- 验证：见 PR。本机没有运行 `pfctl`、没有连接、没有原生构建；规则解析和内核加载由 hosted macOS CI 的 `privileged-tests` 完成。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实机验证（`needs-hardware`）。隧道接口、控制面、出口的放行仍是有状态的：整表清状态时经隧道的 TCP 连接仍会卡住，重连本来也会重建它们。允许的地址集合没有变；多放行的是发往这些地址、原先过不了 `flags S/SA` 的完整 TCP 包（ACK/数据、FIN、RST、SYN+ACK）和回环上的 TCP 分片。到达规则、且 PF 识别为 TCP 的出站分片（发往私网/链路本地）由新增的 `tono-lan-fragment` 丢弃规则继续挡住（评审第一轮的 major：PF 匹配分片时跳过带端口或标志位的规则，无状态放行会让 TCP 分片绕过 53/853 丢弃规则）。三个既有例外没有变：入站建立的状态先于规则匹配；UDP 分片按地址匹配局域网放行、不经过端口丢弃规则；IPv6 分片头后接扩展头的 TCP 不被当成 TCP 匹配（评审第二轮指出；三项记为 MAC-PF-LAN-DNS-FRAGMENT，未关，main 上同样存在）。Continuity 网卡上的包和 main 一样在这些规则之前放行。[决策 046](../decisions/046-2026-10-02-macos-pf-stateless-local-out.md)。

### 2026-10-02 续记：已合 main
- 来源合入：#1331，merge commit `11762878`，PR 头 `8056b883`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37017159063 。
- 独立评审（Codex `gpt-6.1-sol`，high）：各轮范围、发现和处置记录在 https://github.com/raydocs/tono/pull/1331#issuecomment-5954504652 ；最后一轮没有未处理的 major。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
