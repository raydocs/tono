# R3-A1A7 Grok（2026-10-01）

Hunter: Grok 4.7。槽位 R3-A1A7-grok。

范围：

- A1：`apps/windows/app/src-tauri/src/tono/connection.rs`（顶层连接编排）。
- A7：`src-tauri/src/core/service/{mod,install,owner}.rs`，`core/runstate/*`，`core/owner_identity.rs`，`core/manager/*`，`core/proxy_control.rs`，`core/sysopt.rs`，`core/tray/*`。

基线：动手时 `origin/main` 从 `d7e24ec9` 走到 `4453e258`，收尾时是 `a864a9ca`（[#873](https://github.com/raydocs/tono/pull/873)）。#873 只改服务端所有者释放，不改本槽的 App 文件。

关注点：竞态、卡住的状态、崩溃或退出后系统代理还指着死回环、服务安装和所有者、任何会切断网络或把进程挂住的路径。失败要回到普通上网，同时继续拦住 AI 服务。只有显式严格杀开关可以全拦。不把普通失败收紧成全拦，也不拆掉有意的失败关闭。

## Sol 已经覆盖的

`docs/agent-reports/` 里没有 `W1-sol-win-app` 或 `W1-sol-win-trust`。[W1_CODEX_STATUS.md](W1_CODEX_STATUS.md) 写这三个 Sol 云代理没有推出分支就停了，槽位交给 Codex 账号 2，状态仍是 running。去重用的是 [sol2-findings.md](sol2-findings.md)、[sol2-bughunt/REPORT.md](sol2-bughunt/REPORT.md)、[orchestrator-coverage.md](orchestrator-coverage.md)（A1、A7 当时标成 GAP）和当时开着的 PR。

连接编排里 Sol 已记的 w02-3 仍在：`connect_for_generation` 在 `fail_connect` 返回之后，对 `FailOpen` 再调一次 `release_explicit_applying_narrow`。开着的 [#798](https://github.com/raydocs/tono/pull/798)（`codex2/win-connection-races`）就是它。本轮不重复开。w02-4（自愈预检窗口里换节点）也不在本轮修复里。

## 已修

三条都是中·推导。没有新 issue：三条都进了修复 PR。本机 rustc 1.83 编不过 edition 2024 的 Windows crate，`cargo test` 没跑，交给 CI。

| ID | 严重性 | 位置 | 一句话 | PR |
|---|---|---|---|---|
| WIN-SETTLED-QUARANTINE-HANG | 中·推导 | `core/runstate/mod.rs` `settled`、`OperationGuard::drop` | 特权助手超时后槽位留着，`drop` 不 `notify_waiters`，`settled` 永远等 | [#923](https://github.com/raydocs/tono/pull/923) |
| WIN-PROXY-RESET-JOIN | 中·推导 | `core/sysopt.rs` `reset_locked` | 并发清除看见旗标已被占就返回 `Ok`，调用方以为 WinINET 已经清掉 | [#925](https://github.com/raydocs/tono/pull/925) |
| WIN-LOG-SNAPSHOT-HANDOFF | 中·推导 | `core/service/mod.rs` `get_clash_log_snapshot_by_service` | 一次 `NotActive` 就做所有者恢复；StartClash 回复前本地会话已经清掉 | [#929](https://github.com/raydocs/tono/pull/929) |

### WIN-SETTLED-QUARANTINE-HANG

`get_runtime_state`（`cmd/system.rs`）走 `RUN_STATE.settled()`。界面在 `tono://run-state-changed` 上刷新，页面可见时还有 30 秒的兜底重取（`use-system-state.ts`）。`settled` 只在 `op_in_flight` 落下时返回。助手超时把 `privileged_outcome_uncertain` 留下，`OperationGuard::drop` 为了不放进第二个助手，不清除 `operation_running`，也不叫醒等待者。已经停在 `settled` 里的读者，以及之后每一次运行状态读取，都不再返回。

修复：超时的 `drop` 先标上单独的 `operation_quarantined`，再 `notify_waiters`。`settled` 在「没有操作」或「已隔离」时返回仍被占着的快照。第二个助手照旧被拒绝，直到进程重启。隔离期间 `privileged_outcome_uncertain` 也会在活着的助手上为真，所以不能单凭这个旗标就从 `settled` 返回。不释放 WFP，不改代理。

网络：不改路由、TUN、WFP、DNS、防火墙或杀开关。卡住的是状态读取，不是把流量改道。Connect 自己走 `begin_operation`，超时后本来就会马上失败并提示重启 Tono。

### WIN-PROXY-RESET-JOIN

`reset_locked` 用 `compare_exchange` 占旗标。占不上就 `Ok(())`。更新准备、受控停止、所有者丢失后的三次重试都把这个 `Ok` 当成「已经清完」。前一次可能还在写，也可能即将失败。Tono 自己的 WinINET（手动代理正好是 `127.0.0.1:{mixed}` 或 `localhost:{mixed}`，或 PAC 正好是本安装的 `commands/pac`）就会留在死回环上，调用方已经继续往下走，包括停核心。

修复：占不上的一方等到对方结束，然后自己再跑一遍清除。归属判断不放宽。受控停止在清除返回 `Err` 时仍会放弃停核心，服务留着；这是已有测试钉住的合同，不是断网。

网络：只影响已经指向本安装回环的 WinINET。别人的代理或用户自己的代理仍原样留下。清除失败时服务保持运行，不拆 WFP。

### WIN-LOG-SNAPSHOT-HANDOFF

`tono_start_core_with_kill_switch` 在 StartClash 返回前会 `cancel_owner_monitors` 并 `clear_active_service_session`。注释写明这段窗口里服务会如实回答「不是你的会话」，所有者监视器因此做了三次去抖。托盘「核心日志」走 `get_clash_log_snapshot_by_service`，见到一次 `NotActive` 就 `recover_after_owner_loss`：`core_stopped`，并清掉随后 adopt 写上的会话。本地模式变成没在跑，服务侧核心和 WFP 还在。诊断采集路径本来就不恢复。

修复：`log_snapshot_should_recover_owner` 只在错误码是 `NotActive` 且 `active_service_session()` 仍成功时恢复。监视器的三次去抖不变。

网络：不释放 WFP，不改系统代理。避免启动过程中一次日志读取把本地状态打成「没在跑」。会话还在而服务说不是我们时，打开日志仍会恢复。

## 看过、没有另开

| 项 | 结论 |
|---|---|
| `fail_connect` 之后再 `release_explicit_applying_narrow` | w02-3，[#798](https://github.com/raydocs/tono/pull/798) 开着。不重复。 |
| 代理清除失败就中止 `stop_core` | 已有测试：服务留着，退出取消。不是把网络切断。 |
| `stop_proxy_guard_locked` 在 `Pending` 上一直 `yield` | 守卫以 `GuardType::None` 创建，应用里没有 `.start()`。P0-9：Windows 不写系统代理。不是活的挂起。 |
| Windows 连接失败传 `strict_kill_switch_explicit(None)` | `connection/heal.rs` 写明 Windows 没有显式严格档，不为了换节点把机器留在离线。不收紧。 |
| Fatal / 核心消失时的所有者恢复不调用 `tono_release_kill_switch` | 清会话和本安装的代理。放行由服务看门狗、连接监视和已有的 [#740](https://github.com/raydocs/tono/issues/740) / [#777](https://github.com/raydocs/tono/issues/777) 管。不另开。 |
| `install_service` 把退出码 3010 当成成功 | 注释写明：旧服务已重启，二进制下次开机替换。`.status()` 而不是 `.output()`，避免管道句柄死锁。 |
| 旧所有者令牌先 `fs::write` 再套 DACL | 校验看的是所有者，随后 `apply_dacl`。没有证成卡死的释放。 |
| [#873](https://github.com/raydocs/tono/pull/873) | 本轮收尾时已合 main。服务端「没有记录的核心」在仅所有者释放前先停掉。不在 App 的 A1/A7 文件里，不重复。 |

没有达到「单条路径切断普通上网」或「必须产品取舍」的新项，所以没有新 issue。

## PR

| PR | 分支 | 自动合并 | 标签 |
|---|---|---|---|
| [#923](https://github.com/raydocs/tono/pull/923) | `cursor/win-settled-quarantine-1cf5` | 合并提交，2026-10-01T00:54:11Z 打开一次 | 无 `needs-hardware`，无 `ui-review` |
| [#925](https://github.com/raydocs/tono/pull/925) | `cursor/win-proxy-reset-join-1cf5` | 合并提交，2026-10-01T00:55:52Z 打开一次 | 同上。归属判断不变 |
| [#929](https://github.com/raydocs/tono/pull/929) | `cursor/win-log-snapshot-recover-1cf5` | 合并提交，2026-10-01T00:58:38Z 打开一次 | 同上 |
| 本报告 | `cursor/r3-a1a7-report-1cf5` | 不开 | 仅文档 |

管理器若关掉自动合并，保持关掉，不重新打开。没有直接合并。

## 未完成

生产路径读过连接失败与放行、运行状态等待、代理清除、服务启停与所有者恢复、安装退出码、托盘核心日志。`connection.rs` 约 3700 行里的测试体没有逐行重读。托盘飞出窗口的几何不是网络问题。没有在 Windows 上跑 `cargo test`，没有实机，没有 jev-route，没有部署。
