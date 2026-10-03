| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-FLOOR-PERMITS-PERSIST | Windows 意图底座只有 block-all 是 PERSISTENT，回环/DHCP/NDP 放行不是；重启后 Service 起不来时机器没有 DHCP 和回环，只能管理员 CLI 恢复 | fixed(51915ab6) | 分支 `codex/win-startup-release-retry` | 高·推导（读码；与 `intent_floor` 文档注释矛盾） | 底座放行改为持久，命名空间 v12；需 Windows 重启真机验证 |

来源：GLM-5.3 bug hunt「covered by open PRs」一节的剩余缺口（#733/#740 未覆盖）。
