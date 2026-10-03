| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-EMERGENCY-STALE-CORE | `--emergency-disarm`（及其兜底 `releaseNetworkWithoutLedger`）在 `CoreManager` 构造因僵尸 Mihomo 进程扛过 SIGKILL 抛错时整体中止：DNS 不恢复、PF 不拆，文档里的最后手段命令把机器留在断网状态且无下一级出口 | fixed(ed6dee0d) | [#763](https://github.com/raydocs/tono/pull/763) | 高·推导（读码；未实机） | 修复后对仍存活的僵尸 core 只高声警告不强杀，操作者需手工处理；决策钉在 `emergencyReleaseDespiteStaleCore`，与坏账本同形，端到端 disarm 无法进 self-test（会动真实 PF/DNS）；#691 重设计该区域后需重放本语义 |

`terminateOwnedCore`（CoreManager.swift）在 SIGTERM→SIGKILL 后仍存活时抛 `HelperFailure.system("A stale Mihomo process could not be stopped.")`；
原先该错误从 `runEmergencyDisarm` 的 disarm 闭包逃到外层 catch，落入 `releaseNetworkWithoutLedger()`，后者又先 `try CoreManager(...)` 再次抛错，
最终只打印「could not release PF」并返回 false，PF 保持武装。修复（分支 `glm/mac-helper-recovery`）：两处构造均改为 best-effort——
警告后继续 DNS 恢复（尽量）+ `manager.disarm()`；有待定更新且无 core 时走普通释放路径，更新证据不动。
