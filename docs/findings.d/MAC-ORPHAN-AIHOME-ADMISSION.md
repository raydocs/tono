| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ORPHAN-AIHOME-ADMISSION | macOS 新登录时仅余 AI Home 会话记录、实际保护已结束，准入仍沿用该记录，使无家宽账户无法按默认回退 Stable | in-PR | [#1730](https://github.com/raydocs/tono/pull/1730) | 低·推导（P3） | 仅源码路径确认；修复与 staged XCTest 已写，hosted RED/GREEN、独立差异审查和安装机跨登录验证待完成；不是仍有 AI 保留保护时自动降级的授权 |

2026-10-23，五模型审计 macOS F2 的有界落实。`armed || wanted == false` 不代表 selective AI hold 已结束，清除 defaults 也不能清掉已构造 coordinator 的内存值。

新认证在开始时没有已拥有账户、凭据已 durable adopt、账户未停用且当前认证呈现仍有效时，调用 AppState 专用用途；它在空闲、无原生更新屏障且保护代次未变化时，先获得 authenticated broad false 证据，并要求新鲜 selective false 才清理捕获模式与磁盘记录。实际提交顺序为完成两次观察、再次验证归属，然后同步接受 broad release 并 retire；activation 已先接受同一 broad release 的合法代次也会继续 selective 核对。选择性状态未知/报错/仍 held 时可沿用原 broad reconciliation，但保留模式；取消或被新操作超越时丢弃观察。

不改 saved preference、strict intent、同账户 Check again、静态 signed-out cleanup、helper/PF、路由表或城市故障切换。仍真实持有或不能确认的 AI 保护保留原模式；新账号无 Home 时仍需用户现有 Restore/Disconnect，不推测登录即授权释放保护。
