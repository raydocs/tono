| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-RESOLVER-DIR-HIDES-SPLIT-DNS | `/etc/resolver` 有一个文件读不了时，动态库里已读到的分割 DNS 被整表丢掉，已连接审计不再暂停，匹配域名继续绕过受保护解析器 | in-PR | #836 | 中·推导 | 不把「目录不可读且动态库无冲突」升级成拆隧道 |

`SystemNetworkObservation.current` 用 `fileResolvers.map { supplemental + $0 }`。`resolverDirectoryConflicts` 在目录或任一文件不可读时返回 nil，`Optional.map` 得到 nil，丢掉已经收集的 `SupplementalMatchDomains`。`protectedDNSIntegrity` 在默认解析器仍是 `127.0.0.1` 且该字段为 nil 时返回 `.unverifiable`，会话保持连接。
