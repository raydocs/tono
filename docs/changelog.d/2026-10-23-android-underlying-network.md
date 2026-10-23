## 2026-10-23 · 通用 Android 上行网络元数据跟随
- 归属：SHIP_PLAN §2 item 10 的换网可靠性；不扩展 OEM 或发布通道。
- 来源：main `ca40f3baa`；`fix/android-underlying-network-20261023`，尚未合入。
- 缺陷修复候选：初始上行的静态声明改为跟随当前物理链路，失去上行时明确空集合；
  建立/同步/关闭共用锁，迟到事件读取最新网络，不把旧网络写入后继 TUN。
- 新增/优化：显式继承当前上行的计费属性，修正 target Q+ 默认始终 metered 与原注释不符；
  不声称旧实现已造成蜂窝收费泄漏。不改变路由、授权、账户隔离、TLS 或保护范围。
- 工程与测试：一个独立真平台回归，复用既有本地替身，通过 AIDL 驱动真实服务和正常系统 consent；
  加入现有 tunnel shard，保持他人 settings/UI selector 不变，不扩大 ci-gate 或系统版本矩阵。
- R1 修正：live metadata 的 Binder 异常不再阻断换网对账；沿既有流量 tick 至多重试两次，
  每次读取最新上行，停止时清空；新增一个纯 JVM 故障回归，未扩大 native API/路由契约。
- 授权夹具修正：从 resumed app Activity 启动正常 consent for-result；仍点击系统确认，
  不绕过权限，失败留存窗口 XML。新旧源码保留同一设备回归。
- 验证：仅 scoped diff/selector、测试身份静态检查已接纳；R1 源码审查有一个 minor，候选已修，待末轮审查。
  两个云会话均 out_of_quota；首次设备测试停在授权，不是行为 RED；修正后 RED/GREEN、JVM/lint 均未运行。
  摘要中的新 APK 编译成功没有对应原始附件，未接纳；先前模拟器两次退出 -11 亦未计通过。
- 候选/发布：仅源码，无新签名候选、部署、客户发布或 owner gate 变更。
- 剩余限制：新旧冻结提交的云端执行、精确差异独立审查、真实手机/真实网络与 API 分层仍待验。
