| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-ACCOUNT-REJECTION-KEEPS-TUNNEL-ARMED | 拒绝账户后保留includeAllNetworks隧道及On Demand，节点拒绝身份后整机可能断网 | in-PR | #1745 | 高·推导 | Claude B1；真实NE断开/持久化失败与移动网络联验待真机 |

证据：AppModel.swift:726-752 的 refreshCatalog catch 原先只设置 failure；TunnelController.swift:85-95 的stopForAccount新增 checked On Demand save/load与NE stop，不调用remove/serviceClose；AccountNetworkRelease.handle保留account来源/epoch/at。AccountNetworkReleaseTests覆盖账户限制→先disarm后stop、配置和tokens保留、明确403 DEVICE_REAUTH_REQUIRED同样停止并保留配置（真正401撤权则会话结束、移除配置）、disarm失败仍stop且明确失败、普通网络故障不停止。RED/GREEN链接随本PR验证评论补记，不把mock测试当作真机放行证明。集成顺序：#1741先于#1745，以复用扩展停止意图保护。
