## 2026-10-24 · iOS 用户意图优先的连接状态（T1）
- 归属：SHIP_PLAN §2 item 10 的 iOS 状态缺陷候选；仅源码，无新候选，未合并/部署/发布。
- 来源：分支 `fix/t1-ios-state`，基于 main `322f48c6f`。#1672 已合入（e24adbc21），无在途冲突。
- 缺陷修复：
  - 用户断开不再显示「连接已断开」：去掉 App 停止前多余的 libbox `serviceClose()`；扩展停止中的 service 关闭不记 CORE_STOPPED（`IOS-USER-DISCONNECT-CORE-STOPPED`）。
  - 系统停止后 On Demand 恢复成功，旧失败被清除（`IOS-STALE-FAILURE-AFTER-RECOVERY`）。
  - 连接中退出登录，小组件显示「未登录」：off/未登录便签不被更早会话的负面报告覆盖，signOut 末尾强制发布（`IOS-SIGNOUT-WIDGET-OFF`）。
  - 扩展网络监视器每次启动新建，启动期间的 IPv6 变化会触发重建（`IOS-UNDERLYING-NETWORK-MONITOR-REUSE`）。
- 新增/优化：TonoKit `TunnelIntentLedger`（失败与用户意图集中判断）。
- 工程与测试：先提交行为不变的抽取（24c02b506），再提交 RED 测试（a5409896c），再修复（261acf809）。
  `StateIntentTests` 场景表：用户断开（前台/后台）、连接中退出登录、core 崩溃、jetsam 恢复后用户关闭、恢复后保持连接、取消先于 start。
  取消 vs 晚到 start 的系统侧由已合入的 `TunnelStartCoordinatorTests` 覆盖（`IOS-1672-R1-CANCEL-LATE-START` 改为 fixed(e24adbc21)）。
- 验证：见 PR 的验证评论（RED/GREEN run id）。未在模拟器/真机执行 NE、小组件、Live Activity。
- 移交 T2：无 catalog 时的重试/切换模式（`IOS-ROUTES-STOPPED-RETRY-AND-MODE-SWITCH-NOOP-WITHOUT-CATALOG`）和 403 账户状态码的人话，
  与 T2 `fix/t2-ios-account` 重叠，T1 的实现已用 revert 撤出本 PR（不 force-push）；该 finding 归 T2（#1745），T1 给 T2 的说明写在 #1741 正文。
- 未处理：`IOS-LIVE-ACTIVITY-ENDED-UPDATE`（复核成立，无可测缝，保留 open）。
