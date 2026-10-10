| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-WATCHDOG-WALLCLOCK | macOS helper 空闲循环的 10 s 保护检查用 `Date()` 计时（`SocketServer.run`）：墙钟被往回拨（手动改时间，或 `timed` 纠正走快的时钟）多少，Core 死后的拦截释放、孤儿会话释放、PF 监督和 App 拉起就停多久；Core 已死而 App 不在时，Mac 断网时长从约 30 s 变成回拨的长度 | in-PR | 待开（helper 定时器审计，2026-10-10） | 中·推导 | 改为 `CLOCK_MONOTONIC`（含睡眠、不被拨动），读数倒退也当作到期；自测把回拨一小时的读数喂给调度并要求立即到期；未在真机改系统时间复现；`runBoundedSystemLookup` 的 3 s 期限仍用墙钟（只在查询卡住且恰逢回拨时拉长），未改 |
