| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNSTABLE-ROUTE-NO-HINT | Windows 已连接的线路反复中断（数据面探测失败后恢复或重连），界面每次都回到「已连接」，从不提示用户换线路；现场一位用户在同一条线路上连续 9 天每天 7–30 次探测失败，直到自己手动换节点 | fixed(acb9bafd) | [#1370](https://github.com/raydocs/tono/pull/1370)（提示）、[#1371](https://github.com/raydocs/tono/pull/1371)（推荐跳过这条线路，75f2f12f） | 中·已确认（生产数据） | 只提示不自动换（决策 054）；本机网络反复掉线也会触发；记录只在内存里，重启 App 清零；macOS 没有对应提示；未实机 |

依据：`apps/windows/app/src-tauri/src/tono/connection/monitor.rs` 的 `periodic_data_plane_probe_failed` 在探测失败时只写一条 `healthProbeFail` 审计事件，然后由健康腿决定就地保持、重连或放开；恢复后状态回到 Connected，`TonoStatus` 里没有任何「这条线路最近不稳定」的字段，首页也就没有可显示的东西。失败卡片上的「切换节点」只在连接失败（`TONO_NODE_OR_CORE_UNREACHABLE`）时出现，已连接期间的反复中断走不到那里。

现场数据（2026-10-03 只读查询生产 `connection_events`，仅聚合）：近 14 天 115 条 `healthProbeFail`（`all 3 independent protected TUN probes failed`），Windows 0.0.43/0.0.44，一台设备，同一条洛杉矶线路，09-19 至 09-25 每天 1–30 条；相邻两条的间隔 <1 分钟 14 条、1–3 分钟 13 条、3–10 分钟 17 条、10–60 分钟 32 条、>1 小时 36 条；19 条在某次 `networkChange` 前 30 秒到后 5 秒之内；同期 7 次 `protectedOffline`。09-27 有 4 次 `nodeSwitch`，之后 `healthProbeFail` 为 0。

修复：`TonoInner` 记录已选线路的中断时间（`record_route_probe_failure`，60 秒内的失败并成一次），`selected_route_unstable_until_ms` 在 30 分钟内满 3 次时给出到期时间，`status_of` 带出 `routeUnstableUntilMs`；监控在探测失败处记一次，状态由稳定变不稳定时发布一次状态。首页已连接且未到期时显示提示和「切换节点」。不改任何健康判定。

续（叠在提示之上的 PR）：线路页的推荐（`recommendRoute`）原先只看「24 小时内成功过」和「TCP 可达」，会把正在反复中断的这条线路排在第一位（它刚成功过，端口也通）。现在状态里的 `routeUnstableUntilMs` 未到期时，推荐跳过当前已选线路，给出下一条有新鲜证据的线路；没有别的候选时不推荐。仍然只是选择，不连接、不热切换。
