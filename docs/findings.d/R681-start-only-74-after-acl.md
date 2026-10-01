| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-start-only-74-after-acl | `tono-service-install --start-registered` 在 `target_verifies` 之前先取修复闸，校验失败退出 74 时安装目录 DACL 可能已被重设、`.repair.lock` 已创建（`bin/install_service.rs:1758,1860`） | open | #681 评审 cb8d2f9c → 5a2e265e（grok:F2，codex:F3） | 低·已确认 | 不启动任何服务、SCM 注册不变；退出码注释已按实写明；把校验移到取闸前需另拆互斥，未做 |

停止规则：一轮修复后仍开放（本轮只改注释与记录）。
