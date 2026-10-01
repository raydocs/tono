| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PIN-REFRESH-TEARDOWN | 无后缀策略的后台钉选刷新在 Mihomo 接受新钉之前失败，会拆掉正在工作的隧道并把 PF 收到 bootstrap | in-PR | #950 | 中·推导 | 带网页后缀的产品策略不跑这次刷新。钉已提交后 PF 无法从旧∪新收口，以及提交后被取消，仍拆会话。XCTest 未在本机运行。needs-hardware。仅源码，无新候选。 |

`0a91a921` 把「钉选失败保持会话」并进了自有运行时的 `disconnect(releaseKillSwitch: false)`。函数头注释仍写失败保持会话。监视器在 `webDomainSuffixes` 为空时每 30 个健康周期调用 `refreshManagedDirectPins`。失败发生在 `pinsRuntimeCommitted` 之前时，旧配置仍在生效，这次刷新不是显式严格阻断。
