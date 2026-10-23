| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-IDENTITY-PROPAGATION-WAIT | 通用 Android 将目录 GET 的明确 503 EXIT_IDENTITY_PROPAGATING 直接当作失败，新设备身份未同步完成时必须手动重试 | open | 待验证：fix/android-identity-propagation-20261023 | 中·推导（源码） | 有界等待源码及 staged JVM/UI 回归已准备；未执行编译、行为 RED/GREEN、lint、设备或视觉验收；未合 main |

2026-10-23：基线 `57dc80e73a5f1fc4eff18bf5b5b70d3b98da175b`。来源为五模型产品审计的跨端契约条目，
不同于已修的桌面 `CLIENT-PROPAGATING-SLOW-RETRY`；iOS 同类路径不在本次修改范围。

- 只有目录 **GET** 的 HTTP 503 + 明确错误码可进入等待；其他状态码、其他错误和 refresh POST 不进入本轮重试。
  `readExitCatalog` 在 GET 分类器外执行 bearer/refresh，保留原有一次 401 认证恢复。
- 首次明确传播信号开始一个固定 5 分钟单调预算，每次响应后至少间隔 15 秒；与桌面等待上限对齐，
  但不盲目照搬循环次数：独立截止任务、结果和排队准入都复核预算，HTTP 在途不能延长绝对预算。单独的最多 1 秒截止复核不发 HTTP、不唤醒休眠手机；唤醒且引擎可调度后，最多一个复核周期结束已过期等待，不再额外等待原定时器剩余的清醒时间。
- engine 不 sleep；每次读取仍经 `AccountWorkQueue` 串行刷新并提交凭据。Cancel 不撤销账户 epoch，
  避免丢掉仍属本账户的已轮转 token；已排队但尚未准入的读取被禁止，已经准入的 IO 不强制中断。
  登出/换账号仍按原 queue epoch 拦住旧账户提交；取消/截止后的结果不能启动 Core 或完成后继等待。
- 真实目录仍必须通过 CatalogAdmission、revision 防回退和 TUN 确认；等待不是连接成功。
  连接中刷新目录不替换原准备流程；IDLE 的静默目录刷新也可等，但不会因此自动连接。
- 首页准备状态显示“正在同步线路 · 最多等待 5 分钟”，保留 Cancel；超时后使用既有 Retry。
  不编辑 #1722/#1723 的 Details/settings/strings.xml；准备态首页提示不是新的详情入口，
  既有 Details 在 IDLE/FAILED 展示长说明。通知仍不承诺实时连接状态。

回归源码：`CatalogPreparationTest.catalogPropagationWaitIsBoundedOwnedAndNeverReplaysRefreshPost`
使用真实 ControlPlane HTTP parser/socket seam 与 AccountWorkQueue、受控时钟/IO；
覆盖成功、取消/后继、账户失效、排队发送门、固定截止/迟到响应、非重试错误、GET401 和 POST 分类。
`CatalogPreparationUiTest.preparationShowsWaitAndCancelWithoutClaimingAConnectedTunnel`
穿过真实 TonoRoot，检查短状态、Cancel、Retry、超时详情和没有 Connected 标签；它不是真机或像素证据。

未运行不是通过：旧行为基线是保留单次读取的 staged RED 源码，不是已观察到失败的测试。
待相同冻结测试的实际断言 RED/GREEN、独立精确差异审查、构建/lint、普通手机首登/取消/后台恢复、
中英文大字和 UI 人工验收。无新候选或发布资格。

### 2026-10-23 · R1 时钟修正（源码，仍待运行）

独立 R1 覆盖 `2c8dfd966`，发现一个 P2：elapsedRealtime 包含深睡眠，而执行器相对定时不包含；
在途 IO 无完成回调时，旧单次五分钟定时器不能及时驱动醒来后的到期处理。没有观察到泄漏或设备复现。
局部修正将截止复核间隔限制为 1 秒，HTTP 重试仍为 15 秒，绝对截止不重置；不增加权限、唤醒锁、Alarm 或账户队列占用。
单条 staged 回归改为分离 elapsed/awake 两个时钟，新增“只推进休眠时间、IO 无完成、唤醒 1 秒内到期”的断言阶段。
R1 原生产行为保留在新的 sleep-RED 源码；单次读取 RED 也只移植同一测试，所有最终 staged tests 保持一致。
修正后编译/行为 RED/GREEN/真实休眠仍未运行，最后 R2 尚待完成；不以源修正关闭 finding。
