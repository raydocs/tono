| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R1-CANCEL-LATE-START | Cancel发生在VPN配置save/load await期间，旧start可恢复并启动隧道 | fixed(e24adbc21) | #1672 | 高·推导 | 待实机：真实NE下取消与晚到start的交错未复现。源码：`TunnelStartCoordinator`（App与外部命令共用串行生命周期，start在每次系统等待后核对generation），`AppModel.connect`在start前核对`lifecycle.generation`；`TunnelStartCoordinatorTests`6项（含`testCancelWhileTheFirstSaveAwaitsStartsNothingAndLeavesOnDemandOff`）在feat/ios CI run 39552258167通过，T1线程2026-10-24在322f48c6f本地`swift test`复跑通过 |

本轮源码已集成至WIP，尚未云验、未更新PR；确切新增回归与实现边界见状态矩阵S15–S17。状态保持open，不将静态diff检查写成修复通过。

2026-10-24（T1 · fix/t1-ios-state）：在最新 main 复核，修复已随 #1672 合入（合并提交 e24adbc21）；本线程不改此逻辑。`StateIntentTests` 的「cancel before the start reached the system」行补充显示侧：取消后 App 为 idle、小组件为 off。
