| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PROTECTED-AFTER-PF-RELEASE | helper 会话中 fail-open（重装失败即释放并删除意图）后 health 回 wanted=false/live=false，App 的 isArmed 闩不变，界面与失败路径持续按已保护显示且永不理会 | in-PR | 待开 | 高·推导 | 原位重装每 tick 重试、失败记 `killswitch_heal_reassert_failed`（既有节奏）；重装一直失败时会话以无 PF 在线（macOS 无严格 kill switch 的 fail-open 姿态）；helper 无应答（nil health）不判定；未实机 |

2026-09-30：PF 健康检查新增 `!wanted && !live && isArmed` 分支：记 `killswitch_released_under_session`、清 `KillSwitchService.isArmed`、置 `needsSessionExceptionReassert`，由同 tick 的重装块带会话端点原位重装（成功即恢复闩并消费意图），不拆在线会话。
