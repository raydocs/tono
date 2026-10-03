| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-TUN-TICKS-INFLIGHT | macOS 核心监视在节点切换/配置重载进行中仍累计 TUN 缺失计数，切换结束后再缺一拍就误判 TUN 死亡并拆掉健康会话 | fixed(846705c7) | 分支 `codex/macos-connect-recovery-fixes` | 中·推导 | 进行中清零计数；设备时序未验证；需托管 macOS CI |

来源：GLM-5.3 bug hunt #5（~1416-1446），main `ba7c8ae1`。
