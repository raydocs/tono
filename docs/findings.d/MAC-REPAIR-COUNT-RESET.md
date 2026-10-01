| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-REPAIR-COUNT-RESET | macOS `consecutiveProtectionRepairCount` 在健康会话里从不清零，常开会话中间隔数小时的三次修复事件就进入终止暂停 | in-PR | 分支 `codex/macos-connect-recovery-fixes` | 中·推导 | 连续 30 次健康审计后清零；与 #720 互补；需托管 macOS CI |

来源：GLM-5.3 bug hunt #3（~1532-1543；#720 部分相关），main `ba7c8ae1`。
