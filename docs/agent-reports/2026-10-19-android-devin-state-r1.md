# Android 状态模型 · Devin 第 1 轮（失败，未更新 PR 分支）

- SHA：`629849a1c41ae7816e301426d271cfbb7fd570cc`，`wip/android-state-authority`。
- [云会话](https://app.devin.ai/sessions/facf385888f244008350bd802b592e45)；Linux KVM 快照。
- 原始收据：`~/.local/state/devin-cloud/runs/20261019-131834-wait-facf38588/`，检查清单在仓库外 `~/.local/state/devin-cloud/briefs/android-state-authority-r1.md`。
- 主线程检查了 summary 精确 commit、24 个 check 项、下载的原始日志和全部 JUnit XML，不把 Devin 自报当通过。

## 结果

- 正式主程序/Compose/AIDL/libbox 接口及 AndroidTest 编译、lint：成功；原始 `BUILD SUCCESSFUL in 48s`。lint 0 errors、26 warnings；部分输入未变的任务为 UP-TO-DATE/FROM-CACHE，已披露，不声称全部重新编译。
- 固定 Libbox 摘要匹配，routing source sync 成功；没有修改 pin/产品文件。
- routing：16 执行、0 失败、0 错误、0 跳过；`--rerun-tasks`。
- mobile：103 发现、86 执行（85 通过、1 失败）、17 跳过；原始 `103 tests completed, 1 failed, 17 skipped`，`BUILD FAILED in 38s`。
- 17 跳过来自原有 opt-in ScreenshotRender 15 + MotionPreview 2；不计为通过，不作为 UI/动效证据。
- 七个矩阵相关类：TunnelAuthority 14、SurfaceRules 16、StatusFile 7、ClaimRules 9、NotificationWatchdog 11、EngineClient 7、HomeInteraction 11，共 75 实际执行、0 失败、0 错误、0 跳过。每个矩阵场景在原始 XML 中有对应方法。
- **失败**：`EngineUnitTest.snapshotSurvivesTheProcessBoundary`，旧 fixture 构造 DEGRADED 却没有 applied/attempt；新解码规则保守降为 CONNECTING，原整对象相等断言失败。该测试目标是完整有效快照跨进程序列化；修正 fixture 补真实模型需要的确认字段，保留原整对象相等断言并先断言 tunnelUp，不改变产品代码/评分表/测试数量。独立的无确认降级回归仍保留。
- 首轮没有重试断言，没有启动模拟器，不是所有 Android 测试已经通过。

## 关键原件摘要（主线程计算）

- junit-xml-routing-mobile.zip：14983 bytes，SHA256 `c0652f44c08770bea7c9860c3bbc6443ddc0224f1e1d32e73e6fb3b029ca1483`。
- build-lint.log：11920 bytes，SHA256 `afd8b1dbe0d5ffd1841d35d4970e225582e349e0b79f130428a03ef858db7fe5`。
- mobile-tests.log：21078 bytes，SHA256 `b7f4562b53e81aae42c6181c4286752d0feea889982319ec29fcc32dfe1a9cf7`。
- test-inventory.json：19199 bytes，SHA256 `8deea639aac6cee48911ace9ad419ac46a6a317ef56292eaa2155cc1e065a49b`。

## 后续

修正只提交同一 WIP 分支，使用 send 续接同一个云会话，对新精确 SHA 重跑完整检查。
全绿前不更新 PR #1673 分支。尚无新 CI/冻结/双盲评分数；模拟器 openTun、节点切换、
生产 VpnService 线程链路、UI/无障碍/截图仍是下一阶段验证，不由本轮 JUnit 替代。
真机需求另见 [清单](2026-10-19-android-real-device-checklist.md)。
