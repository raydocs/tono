## 2026-10-11 · 国内家宽测试包（测试者步骤与脱敏报告模板）
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1/G2 现场证据准备；运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（国内可达）。仅文档。
- 新增 [cn-home-broadband-test-kit.md](../ops/cn-home-broadband-test-kit.md)：说明国内 VPS 只能补组件可达性、不能替代家宽客户端；
  A 部分（现在可做，组件证据）用已有无 secret 的 `cn_acceptance.py`；B 部分（候选出来后）六步客户端验收（首登、连接、稳定、掉线恢复、
  手动解除与 DNS 读回、再连）与脱敏报告模板（运营商、日期、候选 SHA / 包哈希、各步结果），不索取密码、验证码、账号邮箱。
- 顺带修正 [cn-acceptance.md](../ops/cn-acceptance.md) 检查表：中继 3c 为三台（含 154.84.56.196，工具在 #1538 已加）。
- 候选/发布：仅文档，无新候选；不购买、不部署国内 VPS。
