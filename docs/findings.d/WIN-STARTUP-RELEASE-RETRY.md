| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STARTUP-RELEASE-RETRY | Windows Service 启动遇到 `wanted: false` 墓碑时 WFP 移除瞬时失败即返回，不再重试；持久 block-all 留下，机器一直断网而 status 报保护关闭 | in-PR | 分支 `codex/win-startup-release-retry` | 高·推导（读码，GLM-5.3 发现，未实机复现） | 修复为后台有界退避重试直至移除成功；需 Windows 真机验证 |

来源：GLM-5.3 bug hunt #1（`windows_kill_switch.rs` ~2618-2631，main `ba7c8ae1`）。
