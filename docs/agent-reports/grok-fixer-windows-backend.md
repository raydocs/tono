# Grok Windows / backend fixer report (2026-10-01)

Fixer: Grok 4.7. Scope: Windows app and service (`apps/windows`) and backend (`services/control-plane`, exit-agent, home-agent, tooling). Base at the end of the pass: `origin/main` `8cd3fd5a`.

Claim comments (`Taking this (Grok Windows/backend fixer)`) were attempted. `gh issue comment` returned `Resource not accessible by integration` (403). No issue in this pass had another fixer's claim comment in the preceding two hours. `needs-hardware` could not be applied: `POST /issues/{n}/labels` and `gh pr edit --add-label` both returned 403.

Auto-merge (`gh pr merge N --auto --merge`) was enabled once on each fix PR below. The queue manager turns that flag off and on; this pass does not turn it back on after it drops. This report PR is non-draft and does not enable auto-merge.

## Fixed

| ID | Area | Severity | File:line | One line | Verdict |
|---|---|---|---|---|---|
| R3-O1 | Windows DNS / WFP | 低 | `apps/windows/service/src/core/dns/mod.rs` `restore_protected` | 恢复已经证明之后删不掉快照，解除杀开关仍保持 WFP | 已修 [#827](https://github.com/raydocs/tono/pull/827) |
| H17-G-F5 | control-plane 会话 | 中 | `services/control-plane/src/sessions.ts` `tokens`；`index.ts` 登出 | 同一设备更早的 refresh 在再次登录、刷新或登出后仍可用最多 30 天 | 已修 [#833](https://github.com/raydocs/tono/pull/833) |
| R3-O2 | Windows DNS 自写窗口 | 低 | `dns/mod.rs` `engine_apply_*` / `sweep_tono_resolver_rule` | 外层超时丢掉 future 时，还在写注册表的线程不再挡住「这是自己的写入」 | 已修 [#841](https://github.com/raydocs/tono/pull/841) |
| #811 / CP-QUOTA-ROLLOVER-GAP | control-plane 节点配额 | 中 | `services/control-plane/src/ops/quota-cycle.ts` `replaceExpiredOpenCycle` | 关闭过期周期和插入下一周期分开提交，插入失败后基线丢失 | 已修 [#852](https://github.com/raydocs/tono/pull/852) |
| #846 | Windows 解除杀开关 | P1 | `service/src/core/server/handlers.rs` `ReleaseKillSwitch` | 先恢复公网 DNS，停 Core 失败时 WFP 仍武装，名字被打到屏障不允许的解析器 | 已修 [#866](https://github.com/raydocs/tono/pull/866)。Core 已停、只是记账失败时不把 DNS 指回没人听的隧道地址，也不拆屏障 |
| #849 | Windows DNS live apply | P2 | `service/src/core/dns/engine.rs` `SCRIPT_PRELUDE` | IPv4 CIM 返回 84 时整块适配器 return，活着的 IPv6 不配置也不重试 | 已修 [#868](https://github.com/raydocs/tono/pull/868) |

## Pull requests

| PR | Theme | Auto-merge now | `needs-hardware` |
|---|---|---|---|
| [#827](https://github.com/raydocs/tono/pull/827) | 锁住的 DNS 快照不再把 WFP 留着 | off（开过一次，之后被关掉，未再开） | 403，未加上 |
| [#833](https://github.com/raydocs/tono/pull/833) | 同一设备作废其余 refresh | off（同上） | 不需要。CI 曾有 1 个失败：再次登录后旧 access token 调 telemetry 得到 401。测试已改用新会话。`npx vitest` 该例通过 |
| [#841](https://github.com/raydocs/tono/pull/841) | 自写窗口跟到注册表写入结束 | off（同上） | 403，未加上 |
| [#852](https://github.com/raydocs/tono/pull/852) | 配额周期关闭与插入同一批次。Fixes #811 | off（同上） | 不需要。`quota.ts` 曾超过 ops 500 行，合约检查失败；开关语句已移到 `quota-cycle.ts`。本地 `test/ops-quota.test.ts` 12 passed，预算检查通过 |
| [#866](https://github.com/raydocs/tono/pull/866) | 停 Core 未完成时把隧道 DNS 装回去。Fixes #846 | off（同上） | 403，未加上 |
| [#868](https://github.com/raydocs/tono/pull/868) | IPv4 返回 84 仍配置 IPv6。Fixes #849 | off（同上） | 403，未加上 |

`cargo test` 未在本机跑：rustc 1.83 编不过 service crate 的 `edition = "2024"`，未安装更新的工具链。Windows 行为由托管 `windows-2025` CI 跑。

## Skipped

| ID | Area | Severity | Why |
|---|---|---|---|
| #829 | Windows 重启后 DNS 停在 `198.18.0.2` | P0 描述，issue 自标决策 | Issue 写明不是补丁请求。放行会拆掉 AI 服务拦截。未改启动恢复 |
| #846 的后半 | Core 已停且记账失败 | 产品选择里的「拆屏障」仍不做 | 拆屏障会同时丢掉 AI 拦截。DNS 黑洞由 [#930](https://github.com/raydocs/tono/pull/930) 补上：恢复 DNS，保持会话时留下当时的 WFP。#866 仍只覆盖停 Core 未确认的那一半 |
| #816 | control-plane v1 计量重放 | 中，两次条件（重置并且重放旧报告） | 需要按报告记账，issue 认为要 schema。未改 |
| #815 | Windows 修复覆盖前任二进制 | 未确认 | 需要应用控制拒绝替换才能复现。未改 |
| #847 | 挂起的更新后继被当成成功 | P1 | 判断线程从未 resume 是 Win32 查询，本环境没有。未改 |
| #850 | 启动接受 Stop 但只发一次 45s wait hint | P1 | 状态句柄是 `cfg(windows)`。错误的刷新循环会把停止挂死。未改 |
| #851 | 未登记后继没有启动时间下限 | P2 | Issue 写明需要和 `Image.started_at` 同一时钟的发布时间，现有时钟对不上。未改 |
| #810 | exit-agent 清单丢失 | — | 已有 [#838](https://github.com/raydocs/tono/pull/838)，随后合入 main。未动 |
| #662 | TUN 路由 8 秒超时 | — | 已有 #663。未动 |
| #789 | Google 邮箱自动关联 | 产品 | Google 登录未开。不修 |
| #4 / #5 | 计量切换 / home-agent 计数器世代 | 已确认 | 不发明世代，不放宽 fail-closed 切换 |
| #602 / TW-OpenAI-1 | DHCP WFP SID | 低，需实机 | 错配会丢掉 DHCP 租约 |
| #317 #208 #188 #183 #210 #257 #331 #409 #422 #664 | 发版开关、ops、macOS、iOS、工具链 | — | 不在 Windows/后端可修范围，或被外部/产品决定挡住 |
| H17-O-F3 | 到期吊销与文案 | 中 | 两种修法要 owner 选 |
| H17-G-F2 | Tailscale 吊销任务不跑 | 中 | 取决于生产是否还有 `tailscale_node_id` |
| H17-C-F2 | 退款销户非原子 | 中 | 要故障注入和设计 |
| H17-C-F1 | 调低设备上限不立刻踢设备 | 低 | 现有测试把踢人定在下一次登录。立刻踢是停用设备，轮换 SQL 在登录路径里，不复制到管理 PATCH |
| BRICK-W5 W6 W7 W8 W9 W10 | Windows 更新/释放 | 中或低 | 未实机，或已有计划（PLAN-win-admin-release 等）。W7 的降级出口是现有设计 |
| R3-O6 | 卸载器在拿不到 owner lock 时仍 disarm | 低 | 与存活 Service 并发写 DNS。不 disarm 会把保护留下，disarm 会和活着的 Service 抢 DNS |
| SFO-1 / #738 | 崩溃后的窄 AI 拦截 | 高，已接受的设计 | 窄层在 #738，不重复做 |
| #691 #694 | — | — | 按任务不碰 |

开放 issue 在本轮开始时 15 条，结束时列表里多了 #811 #810 #815 #816 #829 #846 #847 #849 #850 #851 以及 macOS #817。上面已修或跳过的都没有关闭：合入前不关，决策项保持开放。

## False positives and hypotheses

数过并放下、没有改代码的假设：9。

1. DNS 注册表读回冒充实时证明（BRICK-W7）：现有降级出口，没有新证据。
2. 网络变化一次抖动就重建隧道：已经要连续两次探测失败。
3. 选择性 AI 钩子没注册：#738 拥有那一层。
4. `prepare_for_service_replacement` 在 owner 损坏时 fail-closed：文档写明的保护，不放宽。
5. 用量上报 SQL、邮件 OTP 消耗、目录 UUID 回退：读过，没有新的可修缺陷。
6. home-agent 永久拒绝的报告堵住队列：丢掉报告会少计费。保持重试。
7. 节点配额 `closeOpenCycle`（配额被设为 null）：这条本来就不建下一周期。不是 #811。
8. 支持页警告列表没有 `TONO_DNS_SNAPSHOT_RETAINED`：改 UI 会挡自动合并。#827 故意不改 `support.tsx`。
9. #829 重启黑洞：机制属实，修法会拆 AI 拦截，按 issue 不改。

## Hunt follow-up

同一天两路追查之后又开了两个修复。文档 PR 仍然不启用自动合并。

| ID | Area | Severity | File:line | One line | Verdict |
|---|---|---|---|---|---|
| WIN-STOPCLASH-UNRECORDED | Windows StopClash | P0 | `server/handlers.rs` `StopClash`；`server/mod.rs` `recover_after_unrecorded_stop` | Core 已确认停止、desired state 写失败时，在恢复 DNS 之前返回 | 已修 [#930](https://github.com/raydocs/tono/pull/930)。保持会话时拉不起 Core 就恢复 DNS 并留下当时的 WFP；显式释放走原来的停止过渡 |
| EXIT-LEDGER-MISSING | exit-agent 计量 | P0 | `services/exit-agent/reconcile_and_report.py` `load_state` | 状态文件缺失时把仍在走的原始计数当成新的终身用量 | 已修 [#914](https://github.com/raydocs/tono/pull/914)。本节点水位更高时改记水位，基线留在原始读数 |

| PR | Theme | Auto-merge at this note | `needs-hardware` |
|---|---|---|---|
| [#930](https://github.com/raydocs/tono/pull/930) | 未记账的停止恢复 DNS，保持会话不拆屏障 | 开过一次（2026-10-01T00:58:18Z）。之后若被关掉，不再重开 | 403，未加上 |
| [#914](https://github.com/raydocs/tono/pull/914) | 缺失账本采用本节点水位，不再重复入账 | 开过一次（2026-10-01T00:49:50Z）。之后若被关掉，不再重开 | 不需要 |

`cargo test` 对 #930 未在本机跑：rustc 1.83 编不过 `edition = "2024"`。#914 的 `python3 -m unittest test_reconcile_and_report` 108 通过，对应 vitest 与 `index.ts` 行数棘轮通过。

DIRECT 撤回失败仍把 `consecutive_unhealthy` 清零、非严格释放的 3 次计数因此走不完。这是两次条件（P2 上限），而且改的是 #777 正在改的看门狗循环。留给 [#777](https://github.com/raydocs/tono/pull/777)，这次没有改 `windows_kill_switch.rs`。

#829 和 #846 里「Core 已停、若拆掉 WFP 就会丢掉 AI 底线」的那一半仍不修。#930 只补 DNS，保持会话时不拆屏障。

## Not finished

- 上面跳过表里的 Windows 服务项（#847 #850 #851 #815）和 #816 的 schema。
- #849 没有改「CIM 对象取不到」那条仍会 return 的分支。
- 本机没有跑 Windows `cargo test`。#833 的全量 `npm test` 只在 CI 跑过一轮（修 last_seen 之前 949/950）；修完之后本地只跑了失败的那一例。
- `needs-hardware` 标签没有加上。
- 修复 PR 的自动合并当前都是 off，留给队列管理员。
