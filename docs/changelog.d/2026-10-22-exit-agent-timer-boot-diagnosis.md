## 2026-10-22 · exit-agent 开机 timer 合同缺口诊断
- 归属：[运维计划](../ops/plan-2026-09-11.md) §3.4 executor/identity-sync 的 exit 数据面后续；EXIT-AGENT-TIMER-BOOT；不属于桌面发布冻结/SHIP_PLAN 门。
- 来源：基线 main `d1232520a742b3e747f7b9a228361d696f24a172` → `t3/exit-agent-timer-boot` [#1711](https://github.com/raydocs/tono/pull/1711)（准备性 draft）；未合 main。
- 缺陷修复：无运行时修复；finding 保持 open。完整 service/timer 及生成来源缺失，不能断言没有 OnBootSec，更不能猜运行用户、凭据、周期或安全限制。
- 新增/优化：[诊断](../../services/exit-agent/TIMER_BOOT_DIAGNOSIS.md) 汇集仓库证据、后续获批只读命令、脱敏要求和版本化/冷启动验收条件；README 增加入口。
- 工程与测试：仅文档；不添加缺文件即失败的伪回归。Red check 不适用，无可靠旧 unit/运行时复现；运行时修复的红绿回归须待实际部署合同。
- 验证：MacBook 本地；origin/main 与基线一致，开放 PR 无重复 timer 项，仓库引用与 tracked unit 清单确认缺口；文档链接与 diff 检查见 PR 的 Ran 收据。
- 候选/发布：仅文档，无新包、无新候选、无部署。
- 剩余限制：未做节点只读采证、Linux systemd unit 校验/调度实验、生产冷启动或 roster ACK 验收；本轮禁止这些生产操作。真正 unit/lifecycle 改动前仍需独立高风险审查。
