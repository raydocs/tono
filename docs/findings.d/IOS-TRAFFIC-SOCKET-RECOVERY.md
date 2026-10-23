| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-TRAFFIC-SOCKET-RECOVERY | iOS 统计 socket 连接失败或断开后只清空客户端，隧道健康且没有新 NE 通知时不能恢复，旧回调也未按统计会话隔离 | in-PR | `t3/ios-traffic-monitor-retry`（本 PR） | 低·已确认（云端确定性回归） | 旧行为经仅依赖抽取的 `320bc9e84` 在 Devin macOS 编译成功后真实断言失败；不是未经改动的基线测试。修复的 GREEN、原生构建和准确 SHA 见本 PR 验证评论；shim 测试不证明真实 Libbox/NE 行为，签名真机统计 socket 故障、登出、重连仍待验；预存 P3（早期 Cancel 后迟到 connected 另开统计 run）已在用户授权续修中实现统计意图准入并取得独立目标 RED/GREEN；新增 delta 待父线程审查，签名真机仍未跑，详见末尾续记。 |

调用链：`TunnelController` 的 NE 通知/`load` → `AppModel.tunnelChanged(.connected)` →
`TrafficMonitor.start`。前台 `load` 可能偶然再次触发 start；`readStatus` 的定时重确认与退出探测
不启动统计，也没有外层统计重试。原 `start` 的 catch 和 `disconnected` 只清空 client。
`traffic.onRate` 仅赋值 `rx/tx`，不是连接/保护状态的证据；修复保留这个边界。

重试为 1、2、4、8、16、30 秒封顶，之后每 30 秒继续，只有收到新统计才复位。
停止/登出同步作废统计会话，取消定时器；连接返回、回调接收、主线程交付分别核对会话/实例/样本。
新 NE connected date 替换旧统计会话；非 connected 状态及显式断开立即停止统计。
同步的 native `connect()` 不能被 Swift 侧抢占：停止期间其返回后立即丢弃并断开，不能发布速率或安排重试。
静默挂起且不报告断开的 socket 超时检测不在本项范围。

### 2026-10-22 · 首轮独立审查 P3 续记（当时 open residual，历史记录）
审查 `cf5c919867d55237edec8ab692e2b1a2d683ea12`：`AppModel.swift:379/800`，首次连接时
本地 NE 仍为 invalid/disconnected，Cancel 的 `userStopping` 为 false；迟到 connected 因而可
另开统计 run。即使已有 run 的回调 fencing 正确，也不能阻止 AppModel 发出新的 start。
这是预存低影响统计问题，不代表隧道已取消，也没有证据表明它改变保护真值；P3 保持未修复。

本轮按任务指定兜底只记录风险：外部显式启动来自 `SetTunnelIntent.perform` → App 的
`TunnelCommand.set` → `TunnelController.lifecycle.start`，不经过 `AppModel.connect`。
`TunnelController` 的 NE 通知/前台 load 只提供 status/connectedDate；OnDemand 恢复也走这里。
AppModel-only 锁存会误阻断外部显式启动；按日期解锁无法识别首次迟到 connected；按公开
coordinator generation 解锁无法区分 start 与 stop/remove/cancelPendingStart（意图私有）。
要同时排除旧 connected、允许新显式启动与合法 OnDemand 会话，需要范围外的跨入口意图/会话
关联契约；未猜测新增该契约，未改 wantOn、NE、保护或任何生产/测试代码。

没有新增目标回归或新的行为 RED/GREEN；既有 9 个生产 TrafficMonitor 测试不覆盖这个 AppModel
入口缺口。只沿用原重试缺陷的云端日志和 `cf5c919867d55237edec8ab692e2b1a2d683ea12`
真实 Libbox 编译证据，不冒充本 P3 通过。父线程最终风险处置仍待完成，不新增重复 finding。

### 2026-10-22 · 用户授权的 P3 统计意图续修
先前兜底之后，用户明确授权最小跨入口接缝：只读区分共享 lifecycle 的启动 epoch、显式停止及初始继承，不用任意 generation 变化解锁，也不把 stop/remove 当 start。统计入口移到生产 TrafficMonitor 接缝，已在云端执行一个真实旧准入 RED／修复 GREEN；P3 已实现修复，新增 delta 仍待父线程独立审查，不由实现者自批关闭。隧道所有权/FSM、NE、保护语义和凭证完全不变，新增 delta 由父线程审查。

生产修复：AppModel 只把 account gate 和共享只读 epoch 交给 TrafficMonitor，`userStopping` 继续仅保留原 UI/失败分类含义；统计 nil 意图不能由 NE 的 invalid/disconnected/connected 或 load 清除。新显式 start 同时替换统计 epoch（即使 NE 日期未变），合法 OnDemand 不需要新 generation；初次 load/重启允许继承现有 NE 会话。一个目标时序回归从首次 invalid Cancel、disconnected Cancel 运行到新外部 start、新 App start epoch、OnDemand、外部 Off、SignOut/remove 和初次继承；RED fixture `e535793e4b7d8251c5504e85deb1ab6d9a79e6b3` 仍保留旧准入。云端原始结果如下；不会把 shim 当真实 NE 证明。

续修验证（Devin macOS 同一会话 `bd5233898e6b48a6a5f8a87afd30ff48`）：
- **Red check:** `e535793e4b7d8251c5504e85deb1ab6d9a79e6b3`，旧准入接缝抽取版（非 untouched baseline），`testExplicitStopFencesLateConnectedUntilNewStartAndKeepsOnDemand`：`Build complete! (12.85s)` 后 `Executed 1 test, with 8 failures`、exit 1；首次 invalid Cancel 后 late connected 的 client 实际 1、应为 0；disconnected Cancel 实际 2、应为 1。原始 `p3-epoch-red-final.log`。
- **Ran:** 源码 `d5e7ae509f60e1485bc719a280782248762cfc31`，同一目标回归 1/1、统计 harness 10/10、`TunnelStartCoordinatorTests` 6/6，均 0 failure/skip；RED/GREEN 测试/harness/runner 字节相同。真实 pinned Libbox source/tree digest 匹配后，实际 AppModel/TrafficMonitor/TonoKit 的 unsigned iphoneos Release `** BUILD SUCCEEDED **`、exit 0；不是 shim 构建。日志 `p3-epoch-green-narrow.log`、`p3-epoch-green-all.log`、`p3-epoch-coordinator.log`、`p3-epoch-libbox-provenance.log`、`p3-epoch-real-libbox-build.log`、`p3-epoch-checkout.log` 已下载并核对；本地目录 `/Users/ruirui/.local/state/devin-cloud/runs/20261022-194916-wait-bd5233898/attachments/`。后续仅文档变动沿用此源码证据，不冒充新 head 重跑。
- **Not run:** 新增 delta 的独立审查（由父线程执行）；签名/真机 NE/socket、真实 OnDemand、widget/Live Activity/Control Center、账户服务及设备端登出时序；UI/模拟器/a11y 与无关全量套件。既有 9 个重试测试仅作回归防护，不是 P3 证明；本轮没有发布资格、新包、隧道行为改动、合并或部署。
