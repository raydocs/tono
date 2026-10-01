## 2026-09-30 · Windows DIRECT 租约失活放行与 Core 停止屏障

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；影响 Windows Service 的 WFP（`apps/windows/service/src/core/windows_kill_switch.rs`）。
- 来源：main `64af499a` → 分支 `codex2/win-direct-fail-open`；PR #777；已并入 `origin/main` `0484176a`。非严格租约过期释放后调用 `selective_layer::finish_release(true)`，普通网络打开且 AI 拦截装回；严格模式仍停在 Blocked。
- 缺陷修复：App 崩溃、被杀或挂起超过已提交 DIRECT 心跳租约后，看门狗原先撤回 DIRECT 并永久停在健康的 Blocked，非严格用户失去普通网络（`WIN-DIRECT-LEASE-EXPIRY-BLOCK`）。现在先证明 live 精确撤回成功，再复用不健康看门狗的释放路径，删除 WFP、恢复 DNS 并写 disarmed 墓碑；仅 Blocked 意图写盘失败时记警告并继续释放，释放未成功时保留过期的内存租约回执供下一拍重试。显式严格模式及 Pending、Bracket、所有权变化仍保留 Blocked；看门狗对不走释放的已提交租约撤回使用内存 `Retracting` 阶段，避免撤回重试期限被误判为 App 失活。
- 缺陷修复：停止或替换 Core 时，live WFP 已成功装成精确 Blocked，后续意图写盘失败却让 `stop_core` 提前退出，Disconnect 和 owner-gated ReleaseKillSwitch 每次重试都被同一错误拒绝（`WIN-STOPCORE-INTENT-WRITE-BLOCK`）。现在仅此 Core 替换屏障把类型化的持久化失败记为警告后继续，`last_error` 仍保留；live 安装失败及其他 DIRECT 撤回调用方仍返回错误。
- 新增/优化：无。
- 工程与测试：同模块新增两条 `#[tokio::test]`，每项行为一条。`committed_direct_lease_expiry_releases_only_non_strict_sessions` 覆盖 live 撤回失败后重试、非严格释放与墓碑、严格 Blocked，以及所有权变化后的撤回重试仍保持 Blocked。`core_replacement_barrier_accepts_only_persist_failure_after_live_blocked` 覆盖仅写盘失败允许屏障通过且状态保留错误，live 安装失败即使原来已 Blocked 也拒绝。
- 验证：本工作树基线 `64af499a` 的源码修复；`git diff --check` 与已安装 rustfmt 的语法解析通过（仅输出到 `/tmp`，无源码格式化）。本环境无 Windows、Swift/Xcode；Rust 编译与原生测试未执行，hosted Windows CI 待跑。未做 Windows WFP/DNS 实机故障注入，不能声称客户已修复。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Needs real-hardware test (静杰 batch)。live 精确撤回失败仍下一拍重试；WFP 释放、DNS 恢复及墓碑写盘失败的实际恢复需实机。`renew_direct_runtime_reload` / finalize 的幂等已提交回执路径若先于看门狗遇到过期，仍可能清租约并停在 Blocked；普通 disarm 的墓碑写盘失败仍恢复过滤器，owner 退役记录写入失败仍可能拒绝释放。这些相邻路径未改。
