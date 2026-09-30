| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-SNAPSHOT-OVER-8 | macOS helper 读当前 DNS 与 save 无服务器数量上限，loadSnapshot/writeDNS/setDNS/parseDNSOutput 却各限 8 条：>8 台解析源的服务 enable 落盘的快照必然被恢复路径判无效隔离，原始 DNS 永不恢复，enable 失败回滚也被同一上限拒绝 | in-PR | 待开 | 中·推导 | 静态推导，未实机复现；触发面限 >8 台解析源的服务，但纯静态 DNS（无 DHCP 解析源）环境断开后即失去解析（网络丢失级）；32 上限对真实 networksetup/SCPreferences 的接受度为推导 |

2026-09-30：静态确认四层数量上限不一致（SC 读路径无上限、networksetup 解析限 8、save 无检查、load/write 限 8）。
修复用一个共享常量 `maximumDNSServerCount = 32` 统一读/存/载/写，`enable` 在 `save` 前显式拒绝超限列表，helper
自测 `runServerCountCapSelfTest` 证明 9 条列表往返读/写/载入校验、33 条全拒。详见 changelog
`2026-09-30-macos-dns-server-count-cap`。
