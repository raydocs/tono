## 2026-10-27 · iOS / Android：无人看时不再每秒推送速度与通知
- 归属：ops 计划外的移动端测试客户端（不属 SHIP_PLAN 门；Android / iOS 不在本发范围，SHIP_PLAN「明确不进这一发」）；`apps/ios/App`、`apps/android/mobile` 引擎。
- 来源：`main` 6b76cfa → 分支 `amp/mobile-energy-idle-work`；未合 main。
- 新增/优化：
  - MOBILE-IDLE-TICK-ANDROID：隧道开着时，`:vpn` 引擎每 1 s 做一次快照、广播，并向系统重发一次内容不变的常驻通知（NotificationManager IPC），熄屏、无界面时也一样。改后：有界面注册时仍每 1 s 测速；没有时只按 `HEARTBEAT_MS/2`（5 s）走心跳（共享状态仍至少每 10 s 写一次，看门狗闹钟照旧推后），速度归零；常驻通知只在阶段或实例变化时重发，否则最多每 10 s 一次（引擎活着时被看门狗替换的通知仍在一个心跳内恢复）。
  - MOBILE-IDLE-TICK-IOS：app 进入后台后仍保持 libbox 状态流，扩展每 1 s 读状态并写给一个已挂起的进程，直到流控窗口写满。改后：`scenePhase == .background` 关流，回到前台按原有资格规则（显式开关 epoch、登录状态）重开。
- 保留行为：隧道、kill switch（includeAllNetworks / always-on lockdown）、路由、探测、共享状态陈旧判定和看门狗规则不变；只改无人可见的统计与重复通知。
- 验证：见 PR 验证评论（Android JVM 测试与 iOS 构建由 hosted CI 跑；本 orb 无 JDK、Xcode、真机或电池仪表）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在真机测电量；节省量是按调用频率推算（每小时约 3600 次 → 约 360 次通知 IPC；空闲快照 3600 → 720），不是实测耗电。
