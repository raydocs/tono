| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HOME-PROXY-ROTATION-STALE | macOS 连接中所选云节点不变时，同名 homeProxy 节点轮换地址/凭据/Reality 密钥不触发重载，住宅助手路由继续使用旧节点 | in-PR | #781 | 中·推导 | 已补旧/新住宅节点拨号身份比较与一个 UUID 轮换 XCTest；XCTest、实际重载及 PF 端点切换未运行，待托管 macOS CI 与实机验证 |

2026-09-30：`catalogRoutingToken` 只哈希住宅节点名、默认出口与住宅 SOCKS5 元组，不含住宅节点拨号参数。安装目录时保存旧住宅路由名，以 `proxyTarget` 匹配旧/新住宅节点，并由 `CatalogLiveSession.shouldReload` 使用现有 `liveSessionIdentity` 比较；没有住宅节点时保留原行为。
