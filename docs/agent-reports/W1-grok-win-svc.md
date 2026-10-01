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
| [#831](https://github.com/raydocs/tono/pull/831) `hunt/grok-winsvc-report-d3c7` | 合并提交 | 仅文档 |

## 未完成

W4–W9 的指定文件都读过调用关系。没有在 Windows 上跑 `cargo test`（`core/update.rs` 与 `dns/engine.rs` 是 Windows 专用）。没有实机验证 schtasks 删除或开机 DNS。没有做 jev-route 审查，也没有部署。
