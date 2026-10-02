## 2026-10-02 · macOS：App 死后出口不可达时 helper 放开网络
- 归属：SHIP_PLAN §2 第 10 项；macOS root helper（`tooling/scripts/core-helper/SocketServer.swift`、`UpdateRuntime.swift`）。
- 来源：基线 `cc673eaa` → 分支 `fix/mac-orphan-tunnel-20261002`，PR #1357；尚未合入 main。
- 缺陷修复：App 在已连接时崩溃或被强退后，出口再不可达，机器会一直断网到重开 Tono（#1269）。现在 helper 在属主确实已退出、会话已提交、有上行网络时探测出口，连续不可达约 70 秒后停 Core、放开 PF、恢复 DNS。出口可达时不动。条件和被拒选项见决策 049。关联 MAC-ORPHAN-TUNNEL-SESSION。
- 新增/优化：出口延迟探测的请求构造和结果判定从 `UpdateRuntime.verifyRecovery` 抽成 `exitDelayRequest` / `exitDelayVerified`，两处共用，行为不变。bootstrap 孤儿和这条共用同一个放开函数 `releaseOrphanedSession`（日志前缀由 `orphaned bootstrap` 改为 `orphaned session`）。
- 工程与测试修正：回归（`orphanedTunnelAction` 决策自测）先单独推送为 `ed2f9daa`（红），run 37065699770 在 `macos / build` 和 `macos / privileged-tests` 输出 `self-test: a committed session whose owner died is not released when its exit stays unreachable`。helper 协议版本 `4.52.39`，`CONTRACT.sha256` 随修复重算。
- 独立评审：Codex `gpt-6.1-sol` high 审了 `a39bbb0b`，三条 major 都修了：只把 Core 自己答复的 503/504 算作出口不可达（控制端口没结论不计数），并交替两个探测源；新的 arm/start 清掉旧计数和旧探测；读不出新对端身份时属主记为未知而不是沿用上一个（这一条同时改变了 bootstrap 孤儿路径：那种情况下不再按旧属主放开）。第二轮审 `a39bbb0b..a958bf74` 指出这一条引入了退化（App 在 `/core/start` 执行中退出，属主被清成未知，bootstrap 孤儿不再放开，机器一直断网）：改为在对端通过鉴权时就读取身份，请求成功后记录那份身份，执行中退出的 App 仍是属主。结论和覆盖范围记在 PR 评论。
- 验证：仅托管 CI（helper 自测、构建、privileged-tests）；没有 Mac 实机验证，标 needs-hardware。仅源码，无新候选。
