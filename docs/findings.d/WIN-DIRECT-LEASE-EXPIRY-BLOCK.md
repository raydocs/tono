| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-LEASE-EXPIRY-BLOCK | App 崩溃或挂起后已提交 DIRECT 心跳租约过期，看门狗撤回后把 Blocked 判为健康，非严格用户永久失去普通网络 | in-PR | #777 | 高·推导 | 非严格过期先 live 精确撤回再释放；严格及其他撤回原因仍保留 Blocked；renew/finalize 抢先消费过期回执的相邻路径未改，原生测试及实机未执行；Needs real-hardware test (静杰 batch) |

来源：main `64af499a` → 分支 `codex2/win-direct-fail-open`；PR #777；未合 main。归属 SHIP_PLAN §2 第 10 项。

`direct_reload_invalidation_reason` 在已提交 DIRECT 租约失去 App/session 心跳后报告过期；原看门狗调用 `transition_direct_to_blocked_unlocked` 清掉 Core/TUN 许可并重置不健康计数，下一拍验证 Blocked 成功，原有非严格释放不再可达。现在仅对非严格已提交租约过期，在 live 精确撤回成功后调用 `release_unhealthy_session_unlocked` 删除 WFP、恢复 DNS 并写 disarmed 墓碑；仅 Blocked 意图写盘失败使用类型化错误，记警告后仍释放。释放未成功时保留过期的内存租约回执供下一拍重试。看门狗对不走释放的已提交租约撤回使用内存 `Retracting` 阶段，避免撤回重试期限被误判为 App 失活；其他调用方的返回行为不变。

同模块新增一条 `#[tokio::test] committed_direct_lease_expiry_releases_only_non_strict_sessions`，覆盖 live 撤回失败后重试、非严格释放与墓碑、严格 Blocked，以及所有权变化后的撤回重试仍保持 Blocked。`git diff --check` 与已安装 rustfmt 的语法解析通过（仅输出到 `/tmp`，无源码格式化）。本环境无 Windows、Swift/Xcode；Rust 编译与原生测试未执行，hosted Windows CI 待跑；未实机复现或验收。`renew_direct_runtime_reload` / finalize 的幂等已提交回执路径若先于看门狗遇到过期，仍可能清租约并停在 Blocked，此相邻路径未改。仅源码，无新候选。
