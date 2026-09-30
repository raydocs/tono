| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-OFFLINE-COMMIT-STUCK | macOS Protected Offline 原生更新的新 helper 启动释放 PF，旧恢复契约拒绝 Unprotected，提交一直 pending 并挡住 Connect，App 仍按旧义务显示已保护 | in-PR | 待开 | 高·推导 | 恢复与提交阶段只对 Protected Offline 接受真实 Unprotected；App 提交成功后以 helper 实时状态发布保护并放开 Connect。未编译、未运行 helper self-test/XCTest、未实机；`needs-hardware`。helper 版本与摘要待操作员更新；仅源码，未合 main，无新候选 |

复核基线：main `80f4b4d0`，分支 `codex2/mac-update-offline-commit`。`SocketServer.run` 的现有启动释放不改；
不为满足旧契约重装 PF，不自建 AI 阻断层，标准释放路径等待独立 PR #738 接入。Connected 收据仍要求
Connected，Unprotected 收据仍要求 Unprotected；组件身份、所有权、代次、时间与准备阶段的证据校验不变。
提交失败、回执丢失或提交后状态不可读时，既有路径仍可能保留旧保护意图或显示；本次未修该失败分支。
相关交付见 [内部更新记录](../changelog.d/2026-09-30-macos-update-offline-commit.md)。
