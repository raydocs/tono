## 2026-10-10 · Windows：TCP 连续失败 3 次后自动换到同一节点的 hy2 块（A17 Windows 半）
- 归属：ops 计划（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §3 A17，D1-C）；Windows 连接 FSM（`tono-core` + `src-tauri/src/tono/connection`）。macOS 半是 #1499，控制面开关是 #1492（A18）。
- 来源：基线 origin/main；分支 `amp/a17-hy2-auto-switch-windows`；未合 main。
- 缺陷修复：[WIN-HEAL-UNGATED-HY2-HOP](../findings.d/WIN-HEAL-UNGATED-HY2-HOP.md)：粘性自愈在第一次失败后就把下一次拨号换成同节点 hy2，
  不看任何开关 → 自愈候选不再含非用户所选的 hy2 块，自动换 hy2 只走下面的门。
- 新增/优化：
  - `tono-core` 解析目录 200 顶层可选布尔 `hy2AutoSwitch`（缺失 = false，不进 `sha256`/`routingSha256`），每次 200（含「未变化」）都读；
    缓存里的值不用，重启后在第一次实时 200 之前不自动换。
  - 新模块 `tono_core::hy2_switch`：选中的 Reality 节点连续 3 次 TCP 类失败（TCP 预证明失败、`tls handshake eof`、
    `CORE_EXIT_UNREACHABLE`、`TONO_NODE_OR_CORE_UNREACHABLE`）后，下一次无屏障的连接拨同一节点的 ` · hy2` 块
    （同基名、同 IPv4、密码等于 UUID，东京除外）；成功记住 24 h（`hy2-auto-switch.json`，与目录缓存同生命周期），
    记忆内的拨号和原地重连不延长，到期后先试 TCP；自动 hy2 失败回 TCP，该节点 30 min 起倍增、上限 6 h 不再自动换；
    开关变 false、hy2 块消失、用户手选该节点任一块时清掉。手选 hy2 不受影响。
  - 开关开且节点有合格 hy2 块时，自愈停在选中节点上（不先换到同区其他节点）；屏障已武装时不改拨号目标，
    只让自动 hy2 会话原地重连沿用屏障已放行的同一 hy2 端点；从自动 hy2 会话热切换按 hy2 判定，走重建路径。
  - 详细口径见暂定[决定 082](../decisions/082-2026-10-10-hy2-auto-switch-windows-client.md)。
- 工程与测试：一个 `#[test]`：`hy2_switch::tests::three_tcp_failures_dial_the_same_nodes_hy2_only_when_the_flag_is_on`
  （开关 true：3 次 TCP 失败后拨同节点 hy2、不是另一节点的 hy2，记住 24 h 后回 TCP，开关转 false 立即清；开关 false/未读：保持 TCP）；
  `exit_catalog_decodes_response` 加一条断言（缺字段 = false）。
- 验证：Linux orb `cargo test --ignore-rust-version -p tono-core`（345 passed）与 `cargo clippy -p tono-core --all-targets -D warnings` 通过；
  `src-tauri` 未在本机编译或测试（会触发工具链安装），以托管 Windows CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机；需要 #1492 部署、内部账户开关打开、Reality 被拦的网络。自动 hy2 失败的遥测行仍按所选 Reality 节点记传输
  （`connectBegin` 记的是 hy2）；自动 hy2 会话里可选 DIRECT 叠加按现有「拨号名 ≠ 所选名」规则跳过（整隧道）；
  已连在自动 hy2 时 hy2 块从目录消失只清记忆，不拆当前会话。SHIP_PLAN §2.6 三网握手证明仍未做，开关默认全关。
