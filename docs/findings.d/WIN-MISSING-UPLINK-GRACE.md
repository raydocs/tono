| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MISSING-UPLINK-GRACE | Windows 睡眠恢复后上行暂时缺失时，事件探测两次失败即重建并可能选择性放行，没有缺上行的有界宽限 | open | 待开 | 中·推导 | 修法：可靠观察到非 TUN 缺默认路由时给有限宽限，保留 Core/WFP 并显示恢复中，不覆盖 Core/WFP/DNS/归属故障，届满走决策 030/031；DIRECT 失去绑定路由是决策 037 的例外 |

Codex 核验 PARTIAL：15 秒内的成功证明可复用，不是每次恢复都必拆。ROAM-W1（fixed 825333e5）只解决首次事件探测失败立即拆线。记录于 #1386。

2026-10-05 三轮未改：只停计数会让缺上行期间继续显示「已连接」，违反核验要求的「显示恢复中」；诚实显示需要新的连接状态机子状态（保留 Core/WFP 但不算 Connected）和界面改动，并需睡眠/Wi-Fi 实机定宽限。等所有者决定。

### 2026-10-22 · 限域实施前诊断（未修复）

归属：`docs/SHIP_PLAN.md` §2 item 10 / Windows 恢复行为核验。基线
`d1232520a742b3e747f7b9a228361d696f24a172`。仅源码路径确认，没有睡眠/换网实机复现。

- 当前 `connection_health.rs:484–527` 的计划器没有上行观察或时钟输入；一次事件探测失败后保留，
  第二次失败产生 `Rebuild`。已有 `a_second_failed_network_event_probe_rebuilds` 正在断言此行为
  （本次只读，未执行）。`connection/monitor.rs:1185–1187` 调用
  `handle_network_change_inner(..., true)`；若再一次真实数据面验证仍失败，普通非 strict 会话走
  `release_after_health_failure`，带 secondary AI hold 释放后开始 unarmed probe；strict / policy
  rebuild 保持原受保护重连。因此不能把所有情况描述成“一定重建”，也不能把第一次失败的保留
  或 15 秒成功证明复用当成缺上行宽限。
- **空列表尚不是本任务所需的可靠缺上行证据。**
  `connection/platform.rs:371–387` 的 `usable_physical_uplinks` 是 DIRECT 绑定检查：
  只枚举 IPv4 默认路由，`hardware_uplink_alias` 返回错误（包括 `GetIfEntry2` 失败）时也跳过该行，
  最终仍可返回 `Ok(Some([]))`。它不能区分“成功排除虚拟网卡”与“物理网卡查询失败”；
  `Ok(None)` 则明确定义为没有回答，不是没有上行。不能直接用这些结果开始/续期宽限。
  `physical_network_snapshot_windows` 会传播网卡读取错误，但同样是 IPv4 的恢复网络指纹，
  不是现成的全上行缺失证明。后续实现须先明确所观察的路由族及失败/缺失/无回答契约。
- **现有截止时间不是已决定的缺上行宽限。** `ConnectTransaction` 的 310 秒绝对期限约束连接
  事务；`ReconnectBackoff::BUDGET` 的 30 分钟是重试阶梯预算，不是连接寿命的绝对时钟。
  都不能直接移植/每拍重置来延迟健康故障。决策
  [060](../decisions/060-2026-10-05-keep-connected-warn-on-dns-and-uplink.md) 已记录保留 Core/WFP、
  不算 Connected 的恢复子状态，但明确宽限长度/文案待睡眠和 Wi-Fi 设备轮，之前不改代码。
- **本轮不做“只停计数”的修复。** `ConnectionStatus`/`UiState` 与
  `commands::status_of` 没有不拆 Core 的 recovering 子状态；监视循环又以 FSM `is_connected`
  为存活条件。只在指定 `connection` 路径加等待会继续宣称 Connected；直接借用 `tunnel_died`
  则让现有监控和健康处理入口退出，单独调用 `begin_connect` 也不等于一个已被接纳的恢复事务。
  完整实现需要明确授权共享 FSM/状态投影适配范围和一个有依据的宽限上限，再给生产使用的纯逻辑
  边界注入单调时钟。未改这些共享契约，未扩展任务到其他产品路径。
- [#1643](https://github.com/raydocs/tono/pull/1643) 的 PrepareCoreStart takeover 与
  [#1668](https://github.com/raydocs/tono/pull/1668) 的安装恢复均已读取；本轮不改其文件、锁、
  归属或安装行为。后续不得通过新宽限绕过 Core/WFP/DNS/归属故障；DIRECT 绑定确认丢失仍走 037，
  宽限届满仍走 030/031，恢复则必须重新获得真实数据面证明。

验证状态：**Red check: Not run；GREEN: Not run。** 没有新增测试或源码，未把源码阅读、编译失败、
跳过或旧测试现成断言冒充运行证据。MacBook 未运行 native cargo / Swift / xcodebuild，未安装工具链。
后续需 hosted Windows 上实际执行旧源码+新行为回归的 RED，再运行最小修复的 GREEN；一个目标行为
用注入时钟覆盖恢复、固定截止及取消，不 busy wait、不无限续期。睡眠/换网、真实 Core/WFP/DNS
及恢复界面仍 **Not run**；高风险独立审查待父线程完成。本诊断不构成修复或实机资格证明。
