## 2026-10-24 · Android 停止意图、DNS 取消与重新检查 P1
- 归属：SHIP_PLAN G1/G2；Android mobile，修复线程 fix/t3-android，尚未合 main。
- 来源：origin/main `322f48c6f` → 实现 `cde9a1ebc`；[#1742](https://github.com/raydocs/tono/pull/1742)。
- 缺陷修复：断开/撤权先关 TUN 后持久化，失败告警；DNS 取消释放等待且完成至多一次；重查保留已确认隧道；已排队 core stop 受代次/phase 限制，不覆盖用户停止/后继连接。
- 新增/优化：停止意图未能保存时中英文提示重启风险；不声称 Android lockdown 已放行。
- 工程与测试：3 项真实 RED（310651e71）及 core stop RED（ceb8f6862）；最终纯 JVM 57 项 GREEN。只读执行既有传播等待 WIP：f537965b1 RED、74ee58ef5 GREEN，未移植代码。
- 验证：[原始日志与完整限制](../agent-reports/2026-10-24-t3-android/README.md)。Gradle 缺 pinned libbox；Devin API 403 out_of_quota；Compose、全构建、API29/30/34、真实 VPN 未跑，不冒充通过。
- 候选/发布：仅源码，无新候选，无部署、签名、feed 或 migration 改动。
- 剩余限制：未完成的自动恢复/lockdown 全出口、生命周期/监控线程、测速保护及 P2 明细见报告；等待 CI 与编排者 Claude 交叉审查；不合并/不 auto-merge。

### 2026-10-24 · Claude 审查修订
- 接受阻塞项：去掉会吞掉同实例系统 Always-on 新意图的 explicitlyStopped；保持先停后保存，存储失败仍明确告警，不承诺内存标志可阻止后续系统启动。
- 新增真实 Service 入口回归（撤权/断开后 SERVICE_INTERFACE 进入 PREPARING），以及真实临时文件写失败 + BoxPlatform pipe TUN 释放/Toast 接线测试。
- 恢复物理关闭后的 DISCONNECTING 广播，测试/KDoc 与生产接线对齐；pinned 源码证实 serviceStop 是管理 RPC 而非旧 core 退出回调，记录 refuted finding 和升级复核边界。
- 核实历史 head 378c0c376 的 android-ci 40084020477：完整构建、Compose 及 emulator(system/tunnel/ui)通过；不是新 head 或 API29/30/34/真机验证。新增测试执行结果见报告续记。
- 本轮真实 Service RED：282809586 / android-ci 40086755072，两条真实断言失败（Always-on被吞、DISCONNECTING缺失）；第一次测试shadow配置失败不算RED。修复后新head CI待执行。
- 编排者再次推进分支后按要求非rebase合并，无force；集成T8在run40087443121实际要求将已修复的Android recheck探针expected-failure升级enabled，仅改该平台metadata，不改期望行为。服务测试补齐外部watch服务OS binder fixture，生产EngineWatch不变；未把fixture NPE计作行为RED。
