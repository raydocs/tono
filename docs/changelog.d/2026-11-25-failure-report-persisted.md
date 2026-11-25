## 2026-11-25 · macOS 诊断：失败报告写入本地诊断日志，不随退出丢失
- 归属：macOS 客户端，仅源码，无新候选；不是 G4 发布。续 #1859/#1860。
- 缺陷：`ConnectionFailureReport` 只存内存。启动卡住的客户通常会退出再重开，每次重开报告都清空；客户断网时能发的只有诊断日志（登录页「在访达中显示诊断日志」），里面没有逐路径失败和挂起更新的状态。
- 修复：每次记录同时写一条 `LocalTrafficAudit` 事件：`connection_failure_report`（area、paths 如 `direct:timeout, relay:connect`、stopped_early）和 `pending_update_unresumable`（state、phase、blocked、disconnect_requested）。字段是与剪贴板报告相同的封闭词表，不含地址、主机、URL、错误原文、账号；`persist` 可注入，测试不写真实日志。
- 测试：`ConnectionFailureReportTests` 新增一条：两类记录各写出一条事件，字段与预期完全相等，且不含 IP；原有三条改为注入空 persist。
- 未运行：本机不跑 xcodebuild，由托管 CI 验证；红测未在本机运行；未真机验证。
- 说明：只对装了本版本之后的客户端有效；0.0.77 与 0.0.85 的客户端没有这些事件。
