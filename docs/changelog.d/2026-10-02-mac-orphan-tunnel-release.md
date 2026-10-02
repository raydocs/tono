## 2026-10-02 · macOS：App 死后出口不可达时 helper 放开网络
- 归属：SHIP_PLAN §2 第 10 项；macOS root helper（`tooling/scripts/core-helper/SocketServer.swift`、`UpdateRuntime.swift`）。
- 来源：基线 `cc673eaa` → 分支 `fix/mac-orphan-tunnel-20261002`，PR #1357；尚未合入 main。
- 缺陷修复：App 在已连接时崩溃或被强退后，出口再不可达，机器会一直断网到重开 Tono（#1269）。现在 helper 在属主确实已退出、会话已提交、有上行网络时探测出口，连续不可达约 70 秒后停 Core、放开 PF、恢复 DNS。出口可达时不动。条件和被拒选项见决策 049。关联 MAC-ORPHAN-TUNNEL-SESSION。
- 新增/优化：出口延迟探测的请求构造和结果判定从 `UpdateRuntime.verifyRecovery` 抽成 `exitDelayRequest` / `exitDelayVerified`，两处共用，行为不变。bootstrap 孤儿和这条共用同一个放开函数 `releaseOrphanedSession`（日志前缀由 `orphaned bootstrap` 改为 `orphaned session`）。
- 工程与测试修正：回归（`orphanedTunnelAction` 决策自测）先单独推送为 `ed2f9daa`（红），run 37065699770 在 `macos / build` 和 `macos / privileged-tests` 输出 `self-test: a committed session whose owner died is not released when its exit stays unreachable`。helper 协议版本 `4.52.39`，`CONTRACT.sha256` 随修复重算。
- 验证：仅托管 CI（helper 自测、构建、privileged-tests）；没有 Mac 实机验证，标 needs-hardware。仅源码，无新候选。
