## 2026-10-23 · 通用 Android 首连身份同步的有界等待（待验证）
- 归属：SHIP_PLAN G1「连不上且无下一手」可靠性方向（§2 item 10）；仅通用 Android 内部测试客户端，不扩大 0.0.75 发布范围。
- 来源：main 基线 `57dc80e73a5f1fc4eff18bf5b5b70d3b98da175b`；分支 `fix/android-identity-propagation-20261023`，未合 main。
  RED 源码 `f537965b1` 保留单次读取行为并加 staged 回归，不代表已观察行为 RED。
- 缺陷修复：明确目录 GET 503/EXIT_IDENTITY_PROPAGATING 不再立即结束；首次信号起最多 5 分钟、每 15 秒重读，
  当前代次/取消/独立截止/排队发送门限制迟到工作。关联 `ANDROID-IDENTITY-PROPAGATION-WAIT`。
- 新增/优化：双语等待/超时说明，保留 Cancel/Retry；静默刷新不抢走 Connect 的准备流程。
  不修改核心路由、TLS、认证存储结构、权限、保护声明、默认模式或静态通知安全策略。
- 工程与测试：生产 CatalogPreparation + 真实 ControlPlane/AccountWorkQueue 的单条 staged JVM 回归；
  单条真实 TonoRoot 交互回归。无 sleeps、网络拨号、期望值特例或既有测试断言变更。
- 验证：本机只做静态范围/whitespace/资源 XML/测试不变性检查；未执行 Kotlin/Gradle 编译、JVM 或 UI 行为 RED/GREEN、
  lint、instrumentation、截图/无障碍/中文大字、独立审查、真实 API/设备验证。以执行后追加的原始收据为准。
- 候选/发布：仅源码，无新候选、签名包、部署或客户频道发布；不自动合并 UI 改动。
- 剩余限制：Devin 原会话额度不足，未新建 VM 或重复付费派单；源码 review 不替代上述运行门禁。
  已准入 IO 在取消后仍可完成本账户 token/cache 提交，但不能重启连接；首个传播信号前的网络总预算不属本项，
  iOS 同类行为和 Android 换网 WIP 另行验证。其他人的 settings/workflow 及共享 strings.xml 未动。

### 2026-10-23 · 独立 R1 后的一轮局部修正
- R1 覆盖 `2c8dfd966`：一项 P2、无 P0/P1；休眠跨时钟且 IO 无返回时，原截止定时器可能迟到。
- 修正：最多每 1 秒复核同一个 elapsed 截止；不新增网络请求或唤醒锁。设备休眠本身不承诺实时回调，
  恢复调度后最多一个复核周期收敛，结果/发送前截止拒绝规则不变。
- staged 回归：同一 engine 测试分离 elapsed 与 awake，新增无 IO 完成驱动的休眠阶段；
  旧单次读取与旧 R1 定时行为各保留一个 RED 源码。不能把预期断言失败当作已执行 RED。
- 静态检查、最终 R2 和运行结果分别记录；仍未执行任何 Gradle/JVM/UI/lint/设备验证，无新候选。
