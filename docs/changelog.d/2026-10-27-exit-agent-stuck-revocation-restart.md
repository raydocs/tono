## 2026-10-27 · exit-agent：撤销持续失败时可选的限频 Xray 重启（默认关闭）
- 归属：ops 计划（节点可靠性），非发布关口；`services/exit-agent`。
- 来源：`main` → 分支 `feat/exit-agent-stuck-revocation-restart`。
- 新增：`TONO_RESTART_XRAY_ON_STUCK_REVOCATION=1` 时，同一 `u:` 客户端撤销连续 3 轮失败、本轮用量已送达、重启前计数读取并落盘成功、且一小时内没有尝试过，才 `systemctl restart tono-xray`；之后重装名单并确认被撤销的客户端已不在。该轮不发 ACK，下一轮收敛后再 ACK。默认关闭，生产行为不变（只告警）。
- 决策：[140](../decisions/140-2026-10-27-exit-agent-stuck-revocation-restart.md)（provisional）。
- 验证：见 PR 验证评论。
- 剩余限制：未在真实 Xray 节点验证；agent 单元是否有权重启 `tono-xray` 未知；重启会让节点上所有连接中断数秒。
