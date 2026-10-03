| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-TASK-RETIRE-PATH | Windows 原生更新恢复任务退休硬编码 C:\Windows，系统在其他卷时提交/卸载无法删除 SYSTEM ONSTART 任务 | fixed(0ad57ccd) | #776 | 低·推导（读码，未实机复现） | 修复：注册、删除、查询共用 OS 系统目录下的 schtasks 路径；Windows CI 与其他卷实机待验；原查询失败即按任务不存在的判断未改 |

来源：main `64af499a` → 分支 `codex2/win-installer-hangs`；PR #776；未合 main。回归 `update_recovery_retirement_uses_the_os_system_directory` 检查给定 D: 目录的删除命令与参数，本机未执行。
