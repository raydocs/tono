## 2026-10-24 · Android 停止意图、DNS 取消与重新检查 P1
- 归属：SHIP_PLAN G1/G2；Android mobile，修复线程 fix/t3-android，尚未合 main。
- 来源：origin/main `322f48c6f` → 实现 `cde9a1ebc`；PR 待开。
- 缺陷修复：断开/撤权先关 TUN 后持久化，失败告警；DNS 取消释放等待且完成至多一次；重查保留已确认隧道；已排队 core stop 受代次/phase 限制，不覆盖用户停止/后继连接。
- 新增/优化：停止意图未能保存时中英文提示重启风险；不声称 Android lockdown 已放行。
- 工程与测试：3 项真实 RED（310651e71）及 core stop RED（ceb8f6862）；最终纯 JVM 57 项 GREEN。只读执行既有传播等待 WIP：f537965b1 RED、74ee58ef5 GREEN，未移植代码。
- 验证：[原始日志与完整限制](../agent-reports/2026-10-24-t3-android/README.md)。Gradle 缺 pinned libbox；Devin API 403 out_of_quota；Compose、全构建、API29/30/34、真实 VPN 未跑，不冒充通过。
- 候选/发布：仅源码，无新候选，无部署、签名、feed 或 migration 改动。
- 剩余限制：未完成的自动恢复/lockdown 全出口、生命周期/监控线程、测速保护及 P2 明细见报告；等待 CI 与编排者 Claude 交叉审查；不合并/不 auto-merge。
