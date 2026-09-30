| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CANCELLED-QUIT-STOPS-CATALOG-SYNC | 退出或重启中止周期目录同步后选择留在 App，未恢复同步，云目录与流量策略变化直到重启或重登录才生效 | in-PR | 待开 | 中·推导 | 保护重同步后为仍有账户且未在关闭账户的 Ready 认证代恢复周期同步；补齐重启两处取消返回的重同步调用。未新增依赖原生 AppHandle 的注入测试；hosted Windows CI 与实机待跑 |

退出只中止目录/策略循环与连接任务，遥测和日志上传未被中止，不重复启动。
来源及验证见 [更新记录](../changelog.d/2026-09-30-win-quit-release-and-resume.md)。
