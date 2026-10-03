| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-RECOVERY-AI-HOLD | pending update 的断开门丢失自动失败意图，释放 PF 时删除 AI 保留层 | fixed(ad8ab2cd) | hunt/sol-r4dns-update-ai-release | 高·推导 | P1；Swift / PF 无法在 Linux 执行，新增 App 和 helper 窄回归待 macOS CI / 实机 |

已采用的 successor 在 update commit 前发生普通 Core / controller 失败：`applyExhaustedArmedFailure` 请求 `automaticFailureRelease`，pending-update 分支原来无条件执行显式 `update/disconnect`。修复沿同一已认证、持久化 disconnectRequested 的 update 事务传递选择性释放意图，不改 requiredRecovery、高水位、generation 或 successor 身份；用户显式断开仍沿原路径。Helper 版本按推送时 main +0.0.1 提升，并重算全清单 CONTRACT。
