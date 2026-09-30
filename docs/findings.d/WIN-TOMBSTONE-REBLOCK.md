| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TOMBSTONE-REBLOCK | `disarm_unlocked` 在过滤器已全删、DNS 恢复已证明后，tombstone 写失败（ProgramData ACL/杀软锁）改回旧 wanted 意图并 `install_unlocked(previous)` 重装上一策略：写失败持续期间每次 Disconnect 都把刚释放的网络再封上，App 内无出路（只剩紧急 CLI） | in-PR | 待开 | 高·推导 | 修复后保持释放：回退删除 `intent_path()` 使无 wanted 意图幸存，清 ARMED/TUNNEL_PERMIT_RENDERED 并返回 Ok，残余记 `last_error`。剩余：①意图删除也失败时陈旧 wanted 意图留在盘上，下次 Service 启动可能按其重装（fail-closed 恢复契约；`last_error` 已提示重启后重按 Disconnect）；②删意图而非 tombstone 重新打开「缺失意图+残留 WFP 对象⇒紧急块」的原有窄窗（`disarmed_tombstone` 文档所载就地更新停机场景），属换取「当下必不封」的有意取舍；③未 armed 分支的 tombstone 写失败仍返回 Err（彼时无块可留，非本缺陷）；④紧急卸载路径早已用同一取舍（其注释载中国客户机 ProgramData ACL 实况），本项把 Disconnect 主路径对齐。未实机复现 |

来源：2026-09-30 释放路径审计（分支 `glm/win-release-fail-open`，基线 `main` `01c2403f`）。回归测试
`core::windows_kill_switch::tests::a_failed_tombstone_write_after_removal_stays_released`（`TEST_PERSIST_FAILURE` 注入：
不重装、`TEST_INSTALL_ATTEMPTS` 为 0、无 wanted 意图、`last_error` 有记录）。
