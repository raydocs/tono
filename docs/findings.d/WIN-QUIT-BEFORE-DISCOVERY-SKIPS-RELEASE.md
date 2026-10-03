| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-QUIT-BEFORE-DISCOVERY-SKIPS-RELEASE | App 强关后重启，在保护发现完成前退出只看本地 FSM，漏掉上次残留的 Core/WFP/保护 DNS，DIRECT 租约过期后可能断网 | fixed(6be6164d) | #784 | 高·推导 | 本地未报告保护时限时补查 Service，本用户（活动 owner）的 wanted 保护或运行 Core 走显式 owner-gated 释放；无 TonoState 时也可释放。不可读/超时沿用原行为；hosted Windows CI 与实机待跑，PR 须带 needs-hardware |

回归：`quit::quit_tests::quit_before_discovery_releases_service_protection_or_own_running_core`。
来源及验证见 [更新记录](../changelog.d/2026-09-30-win-quit-release-and-resume.md)。
