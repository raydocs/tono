## 2026-10-23 · 修复 Android 10/11 网络监控权限缺失
- 归属：SHIP_PLAN §2 item 10 的通用 Android 可靠性缺陷候选；Android 仍为内部测试端，不关闭桌面发布门。
- 来源：`0465af814` → 回归源码 `4fbf1e6a4` → `fix/android-legacy-network-permission-20261023`；未合 main。
- 缺陷修复：`ANDROID-LEGACY-NETWORK-PERMISSION`；声明 `requestNetwork` 所需的正常安装权限，
  不使用特殊设置权限，不修改 VPN consent、路由、后台生命周期和 fail-closed 行为。
- 新增/优化：无新产品能力；保留现代 Android callback 路径和调试包交付限制。
- 工程与测试：单一真实 instrumentation 回归加入 API34 system shard；BUILD_AND_TEST 补充 Android
  独立工作流、最低系统版本云端验证要求与其不属于 `ci-gate` 的边界。
- 验证：精确回归 SHA 的云端 API29 `Tests run: 1, Failures: 1`，真实未登录 service 创建也崩溃；
  同 APK API34 `OK (1 test)`。详见 finding 的会话与附件。修复 GREEN/原生 CI/独立审查待补。
- 候选/发布：仅内部调试回归；无签名客户包、部署、合并或发布。
- 剩余限制：API30 尚未运行；没有 API31–33/35–36 全矩阵、真实手机、Wi-Fi/蜂窝切换或 lockdown 验收。
