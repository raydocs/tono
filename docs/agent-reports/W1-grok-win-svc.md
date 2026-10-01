# W1-grok-win-svc

Hunter: Grok 4.7。基线 `origin/main` `c26025ec`。范围：W4 服务生命周期、W5 DNS、W7 更新事务、W9 安装/卸载。

假设 29 条。假阳性 16。已知重复或已接受 11。已修 1。未修、需产品决定 1。

## 结果

| ID | 区域 | 严重性 | 位置 | 一句话 | 结论 |
|---|---|---|---|---|---|
| WIN-UPD-RETIRE-SCHTASKS | W7/W9 | P2 | `core/update.rs` `retire_recovery_task`（`c26025ec` 约 976–991 行） | 退休恢复任务写死 `C:\Windows\System32\schtasks.exe`，非 C: 系统盘删不掉 `Tono Update Recovery v1` | 已在 [#824](https://github.com/raydocs/tono/pull/824) 修复 |
| WIN-BOOT-HOLD-DNS | W4/W5 | P1 | `desired.rs` 约 241–248 行；`windows_kill_switch.rs` 有效 wanted 开机臂；`dns/mod.rs` `initialize_status_cache` 约 3157 行 | 重启后不重放 Core，保护 DNS 仍指向 `198.18.0.2` | 未修，[#829](https://github.com/raydocs/tono/issues/829)。恢复普通 DNS 会拆掉当前 AI 屏障 |
| — | W4 | — | SCM 停止 | 停止服务不恢复非严格 DNS/WFP | 重复 [#792](https://github.com/raydocs/tono/pull/792) |
| — | W7 | — | `update.rs` Prepare | 停 Core 后保留启动期 WFP 和死 DNS | 重复 [#793](https://github.com/raydocs/tono/pull/793) |
| — | W9 | — | 安装器 | BFE 挂起、恢复任务路径、重启就绪 | 重复 [#776](https://github.com/raydocs/tono/pull/776) |
| — | W7 | — | Prepare 监督 | App 侧 Prepare 失败监督 | 重复 [#779](https://github.com/raydocs/tono/pull/779) |
| — | W4 | — | `runtime.rs` | 不可解析的 core 运行记录挡住启动 | 重复 [#775](https://github.com/raydocs/tono/pull/775) |
| — | W5 | — | `dns/mod.rs` `registry_values_match` | GUID 大小写比较 | 重复 [#754](https://github.com/raydocs/tono/pull/754) |
| BRICK-W7 | W5 | 已知 | `dns/engine.rs` 恢复读回 | 实时证明读的是刚写的注册表 | 已知 open，未当新缺陷 |
| BRICK-W9 | W9 | 已知 | `update_executor.rs` 约 399、519 行 | 先关掉 SCM 重启动作，`configure` 失败就装不回去 | 已知 open，未当新缺陷 |
| R3-O1 | W5 | 已知 | `restore_protected` 删快照 | 已证明恢复后删快照失败就拒绝拆 WFP | 已知 open，低 |
| R3-O7 | W5 | 已知 | 无快照的 `127.0.0.1` | 当成用户自己的解析器 | 已接受的设计；#754 明确不把裸 `::1` 当成 Tono 残留 |
| BRICK-W1 | W4 | 已知 | `boot_session.rs` / `desired.rs` | 开机不重放 Core | 代码已在树上。剩余的 Protected Offline 与 WIN-BOOT-HOLD-DNS 是它的后果，不是把守卫删掉 |

## 假阳性

1. `native_apply.rs` `confirms` 在接口索引为 0 时要求该族解析器为空，而 `apply_native` 跳过索引 0。结果是原生确认失败，走兼容回退，不是静默漏放。
2. 保护态 IPv6 空列表传给 `SetInterfaceDnsSettings`。代码要求读回空列表，对不上就回退。没有证明空字符串会被当成 DHCP 且读回仍报空。
3. `system_lookup_a` 超时后飞行标记留到工作线程返回。建议性查询，不占 `DNS_OPERATION`，不是服务卡死。
4. `restore_encrypted_dns` 删除 NRPT 后没有 `remove_nrpt_rule` 那种读回。`RegDeleteKeyW` 成功即键已删除；有子键时返回错误，恢复失败，屏障保持。
5. IPv6 先写 `NameServer` 再写 `ProfileNameServer`。崩溃窗口没有证明成全机断网。
6. `apply_snapshot` 把不在活动集里的适配器先标成成功，随后仍写注册表，写失败则整次返回错误。
7. 快照只在证明恢复或卸载阶梯已离开 Tono DNS 之后才隔离。快路径不会在适配器仍指向 `198.18.0.2` 时把快照当成已不存在。
8. 更新 Disconnect 在 WFP 已释放后把记账失败放进 `needs_attention`。这是避免把已经打开的机器显示成 Protected。
9. `incarnation_live` 把 `image()` 的错误当成进程已死。需要再叠加一次拒绝访问，达不到单独的断网路径。
10. 所有者锁 pid 文件在 Drop 时删除。毫秒级，不修。
11. `start_registered` 对已经在跑的服务仍等 IPC。有意为之。
12. 日志里的卸载失败重启提示。服务删了而解除未证明是注释里的合同；有害句在 `DetailPrint`。
13. `path_is_below_root` 在最终路径上比较，`..` 先被规范化。
14. 更新日志非法阶段写成 Failed 再返回错误。安装器入口 `record_install_started_for_installed_app` 当前没有调用点。
15. App `schtasks.rs` 在没有 `SystemRoot` 时退回 PATH。不在本槽；NSIS 卸载自启动用的是 `$SYSDIR`。
16. 兼容回退按 GUID 精确比较。对不上就当未验证，方向是拒绝而不是放行。与 #754 同类，不单开。

## PR

| PR | 自动合并 | 标签 |
|---|---|---|
| [#824](https://github.com/raydocs/tono/pull/824) `hunt/grok-winsvc-retire-schtasks-d3c7` | 已开，合并提交 | 无 `needs-hardware`（不改路由、TUN、WFP、DNS、防火墙、杀开关、代理），无 `ui-review` |
| [#844](https://github.com/raydocs/tono/pull/844) `hunt/grok-winsvc-update-observe-dns-d3c7` | 已开，合并提交 | `needs-hardware` 加标签返回 403，未加上。无 `ui-review` |
| [#831](https://github.com/raydocs/tono/pull/831) `hunt/grok-winsvc-report-d3c7` | 合并提交 | 仅文档 |

## 后续（对照四路复查）

复查来源：[W4 服务生命周期](bc-04deee14-656b-59d1-b89b-01b276e22031)、[W5 DNS](bc-666b6a00-68c6-5668-8e64-01dfeb45a2c7)、[W7 更新回滚](bc-cd43d64d-1210-5bb2-b711-331273d1b789)、[W9 安装卸载](bc-3b57c82d-bfcc-574f-94a6-80c1e7228c13)。下面只保留对照源码后仍成立的项。

| ID | 区域 | 严重性 | 位置 | 一句话 | 结论 |
|---|---|---|---|---|---|
| WIN-UPD-OBSERVE-HEAL | W5/W7 | P1 | `dns/mod.rs` `observe_for_update` | 更新证明在快照缺失时把隧道 DNS 改成 DHCP 并拆 NRPT，屏障仍 wanted | 已在 [#844](https://github.com/raydocs/tono/pull/844) 修复。本机 Cargo 1.83 不能编译 edition 2024，测试未跑 |
| WIN-REL-DNS-BEFORE-STOP | W4 | P1 | `server/handlers.rs` 释放杀开关 | 先恢复公网 DNS，Core 回滚失败就返回，WFP 仍挡住这些解析器 | 未修，[#846](https://github.com/raydocs/tono/issues/846)。Core 已死时是否放行是产品选择 |
| WIN-UPD-SUSPENDED-SUCCESSOR | W7/W9 | P1 | `update_executor.rs` 活着的后继进程直接返回 | abort 或外部结束执行器后，从未 Resume 的进程被当成恢复成功，服务保持停止 | 未修，[#847](https://github.com/raydocs/tono/issues/847) |
| WIN-SCM-STOP-HINT | W4 | P1 | `service.rs` `STOP_WAIT_HINT` 45s | 启动阶段已接受 Stop，只报一次 45s；DNS 恢复预算是 40s，还可能再来一次 | 未修，[#850](https://github.com/raydocs/tono/issues/850) |
| WIN-DNS-CIM-84 | W5 | P2 | `dns/engine.rs` `Set-AdapterDns` | CIM 返回 84 时直接 return，IPv6 `netsh` 不跑，适配器却算成功 | 未修，[#849](https://github.com/raydocs/tono/issues/849) |
| WIN-UPD-ADOPT-NONE | W7 | P2 | `update_transaction.rs` `authenticate_successor` 的 `None` 臂 | 没有记录后继进程时，不要求 `started_at` 晚于发布 | 未修，[#851](https://github.com/raydocs/tono/issues/851)。不能拿 Unix 时间去比 `started_at` |

复查里没有另开的项：WFP 已释放后 DNS 恢复失败不再重试，是 #733 留下的限制。`schtasks` 无超时与 #776 同类。写死的 `C:\Windows\System32\schtasks.exe` 已由 #824 修。原生 IPv6 空列表被读回当成成功：模块自己写明 WFP 已拦截 IPv6 DNS，空注册表和 DHCP 在注册表里无法区分，不能把“空读回”单独证成漏放。`read_sz` 把长度为 0 或奇数的值当成缺失，奇数长度可疑，但 0 也是空值，没有拆开验证。回滚完成后仍保持 Blocked，是恢复义务，和 #793、#829 同一类决定，不另开修复。`--replace-runtime` 没有调用 `record_install_started_for_installed_app`，日志停在旧阶段，但不自己把机器留在离线。

#844 需要 `needs-hardware`。`gh api` 加标签返回 403，标签没有加上。自动合并已开。

## 未完成

W4–W9 的指定文件都读过调用关系。没有在 Windows 上跑 `cargo test`。没有实机验证 schtasks 删除、开机 DNS，或这次更新证明的自愈。没有做 jev-route 审查，也没有部署。

## 修复轮（2026-10-01）

对照当时的 `origin/main`。认领评论 `Taking this (Grok win-svc)` 没有写上：`gh issue comment` 和 REST 发评论都返回 403 `Resource not accessible by integration`。开工时 #847、#850、#851 没有别人的评论或 PR。标签 403 按约定忽略。

| Issue | 处理 | 头 / 状态 |
|---|---|---|
| [#846](https://github.com/raydocs/tono/issues/846) WIN-REL-DNS-BEFORE-STOP | 跳过。另一位 Grok 的 [#866](https://github.com/raydocs/tono/pull/866) 仍开放，可合并，自动合并开着 | `fc8b86dc` |
| [#849](https://github.com/raydocs/tono/issues/849) WIN-DNS-CIM-84 | 跳过。同一位的 [#868](https://github.com/raydocs/tono/pull/868) 已合入。IPv4 CIM 84 只清掉 IPv4 期望，随后仍配置 IPv6。Issue 已关闭 | 合并 `36844a4a` |
| [#847](https://github.com/raydocs/tono/issues/847) WIN-UPD-SUSPENDED-SUCCESSOR | Codex [#858](https://github.com/raydocs/tono/pull/858) 已合入：恢复前 `resume_successor` 唤醒身份匹配的后继；非严格下目标 Service 起不来走 `emergency_disarm_windows_kill_switch`，严格杀开关仍阻断。本代理的 [#887](https://github.com/raydocs/tono/pull/887) 是第二套实现，与 main 冲突，自动合并已关，留在队列外 | #858 合并 `b17ddc32`；#887 头 `dcc07de0` |
| [#850](https://github.com/raydocs/tono/issues/850) WIN-SCM-STOP-HINT | [#902](https://github.com/raydocs/tono/pull/902)。main 上的等待提示已是 65 秒。刷新周期 15 秒，短于一次 40 秒 DNS 预算，也短于提示本身。检查点每次重报递增。刷新线程在最终 Stopped 之前 join。自动合并开着，可合并，检查尚未跑完 | `506ce4fa` |
| [#851](https://github.com/raydocs/tono/issues/851) WIN-UPD-ADOPT-NONE | [#911](https://github.com/raydocs/tono/pull/911)，基线已含 #858 和 #868。`publication_clock` 可选；缺省仍采纳旧记录；已有下限不再后移。时钟与 `Image.started_at` 相同，是 FILETIME，不是收据的 Unix 时间。字节落盘之后、CreateProcess 之前记下。自动合并开着，可合并，检查尚未跑完 | `4b6c6cca` |

本机（rustc 1.98.1）跑过：

- `cargo test --locked --features standalone,client,test --lib scm_stop_hint_refreshes_before_a_dns_restore_can_outlive_it`：1 passed。
- `cargo check --locked --target x86_64-pc-windows-gnu --features standalone,client --bin tono-service`：通过。
- `cargo test --locked --features standalone,client,test --lib update_transaction::`：14 passed（rebase 前）。rebase 到含 #858 的 main 之后，`update_unregistered_successor_must_start_after_the_publication_clock` 1 passed。
- `cargo check --locked --target x86_64-pc-windows-gnu --features standalone,client --bin tono-service-install --lib`：通过。

没有 Windows SCM，也没有挂起进程或真实发布时钟。旧执行器重写 `state.json` 时会丢掉可选的 `publication_clock`，下限随之消失。本报告 PR 不开自动合并。没有部署，没有 jev-route。
