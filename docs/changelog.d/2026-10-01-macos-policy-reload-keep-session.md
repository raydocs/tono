## 2026-10-01 · 已连接时的策略更新不再整机阻断

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；macOS 已连接会话的流量策略。
- 来源：main `27e65ba6` → 分支 `cursor/r3-policy-reload-release-89a9`；PR #966；未合 main。
- 缺陷修复：策略内容变了且正在连接或已连接时，原来 `disconnect(releaseKillSwitch: false)` 再保护重连，PF 停在 bootstrap。现在保持当前会话并就地应用。应用失败且不是显式严格模式时，恢复原来的网络，不再安排保护重连。关联 MAC-POLICY-RELOAD-BLOCK。
- 新增/优化：无。严格 `permanent` 仍保持阻断并重试。macOS 不保存这个开关，调用传入 false。
- 工程与测试：`OptionalPolicyTests.testConnectedPolicyUpdateKeepsTheSession` 与 `testBackgroundPolicyFailureRestoresTheOriginalNetwork`。失败用 `optionalPolicyRuntimeMutation` 抛出，断开的特权调用换成空操作。续：四句新提示补了 zh-Hans。合入 main 时保留替换 Core 之前的 keepSession（重装原来的 PF 例外，不拆正常连接）；替换已经开始或这次重装失败时，走非严格整网放行，不再 `disconnect(false)` 加保护重连。
- 验证：Linux 工作树逐行对照。无 Swift/Xcode，未编译、未运行 XCTest；hosted macOS CI 待运行。目录 JSON 用 Python 读过。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络行为变更，needs-hardware。选择性 AI 底未在此安装。钩子未注册时，失败是整网放行，不声称真实 IP 到不了 AI 服务。目录删出口是 #963。
