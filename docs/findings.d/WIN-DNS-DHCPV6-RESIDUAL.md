| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-DHCPV6-RESIDUAL | Windows 原生 DNS 写入的读回要求有效 IPv6 解析器为空，DHCPv6/RDNSS 动态解析器残留时走兼容回退、记 pending 并由看门狗重放 | open | 待开 | 低·实机 | 需在 Win10/11 的 DHCPv6、RDNSS 实机确认原生空值与兼容命令能否清除；不得放行物理解析器；空注册表值不能当作完全验证 |

Codex 核验 NEEDS-HARDWARE。记录于 #1386。
