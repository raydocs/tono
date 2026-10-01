## 2026-09-30 · Windows HY2 住宅路由与切换修复
- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；影响 Windows App 的 WFP 端点、mihomo 住宅路由与节点切换。
- 来源：main `026e747c` → 分支 `codex2/win-hy2-routing`；PR #783；未合 main。
- 缺陷修复：住宅 TCP 端点与 HY2 出口共用地址、端口时，按 IP、端口、协议去重，保留两种许可；连接阶段复用同一端点构造。配置住宅路由时，在 TCP 住宅规则后为同一域名、CIDR、进程名和路径匹配补 UDP REJECT，HY2 也让助手回退到住宅 TCP。VLESS 与 HY2 互切或旧节点未知时，直接走现有保持 WFP 武装的冷切换，重建传输相关规则。关联 `WIN-HOME-ENDPOINT-DEDUP-PROTOCOL`、`WIN-HY2-HOME-UDP-LEAK`、`WIN-HOT-SWITCH-PROTOCOL-CHANGE`。
- 新增/优化：无。
- 工程与测试：每个行为各加一条 Rust 回归，共三条；更新住宅规则顺序断言及 App 的 DIRECT 图校验和既有控制器 fixture，使其识别新增 UDP 住宅拒绝块。
- 验证：本 worktree 人工逐行复核 Rust 差异；`git diff --check` 和记录读取检查通过。无可用 cargo、Xcode 或 Windows，未运行 Rust 单元测试、原生构建、WFP、QUIC 回退及冷热切换实机测试；由 hosted CI 执行 Rust 检查，实机结果仍待补。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`，不能声称客户已修复。sing-box 虽编入 tono-core，Windows 产品连接路径没有调用其生成器，同类 UDP 住宅缺口按本任务边界保留。既有 HY2+DIRECT 图校验仍要求全量 UDP REJECT，未在本轮修正。
