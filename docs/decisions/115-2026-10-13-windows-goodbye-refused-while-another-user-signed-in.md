## 2026-10-13 · 一个用户的未连接退出可以让机器范围的 Service 自停吗（另一用户已登录时）
- Status: provisional（所有者可推翻；只有所有者能写 `owner` 或 `reversed`）
- Chosen: 只要另一个用户有 Windows 登录会话（活动、已连接或已断开），`POST /lifecycle/owner-goodbye` 以 `StillProtected`（409）拒绝，Service 继续运行。判断沿用 `owner_signed_in` 的规则：读不出的会话按“有人登录”处理。被否决的方案：由 Service 记录各用户 App 是否在运行（要新增在线登记协议，无法在未连接状态下可靠清理）。
- Why stricter: 只会让空闲的 Service 多运行一会儿，不放宽任何保护；原来的 `wanted`、desired-state 两条拒绝不变。解决的是 #1293 第 2 项：用户 B 的未连接退出把 Service 停在用户 A 的空闲 App 下面，A 的下一次 Connect 需要 `--start-registered` 的 UAC。代价：多用户机器上 Service 不再随最后一个退出的用户自停（它本来就是 AutoStart）。
- Applied in: 本 PR（`apps/windows/service/src/core/server/{mod,handlers}.rs`、`core/windows_kill_switch/session.rs`）
