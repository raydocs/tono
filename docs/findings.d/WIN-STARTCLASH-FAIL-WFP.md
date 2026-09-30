| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STARTCLASH-FAIL-WFP | StartClash 装好 WFP bootstrap 臂后 owner-proxy 迁移失败只报原错误不收臂，App 侧后续 status 读取再失败时 `armed` 回落 FSM 闩锁（false）、会话门控的停止核失败被忽略：机器保持全封而界面显示未连接 | in-PR | 待开 | 中·推导 | 修复在 Service 侧：本次请求装过 Windows 臂且迁移失败即用 superseded-by-Disconnect 分支同一条 `windows_kill_switch::release()` 回滚（保持 DNS-before-disarm 不变式），回滚失败并入原错误消息。仅覆盖迁移失败这一返回点——成功后的 `disable_kill_switch`/`add_restored_kill_switch_tunnel` 两分支在 Windows 上是 macOS stub（返回 Ok）不可达，macOS 臂按既有注释有意保留；用户手动 Disconnect 本就可解（release 非会话门控），故评中而非高；未实机复现（推导自 handlers.rs StartClash 与 app `connection.rs record_connect_failure` 的 armed 回落链） |

来源：2026-09-30 释放路径审计（分支 `glm/win-release-fail-open`，基线 `main` `01c2403f`）。回归测试
`core::server::handlers::start_clash_arm_rollback_tests`（纯函数半边：原错误保留、code 不变、回滚失败可见）。
