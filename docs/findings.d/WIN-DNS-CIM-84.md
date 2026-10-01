| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-CIM-84 | DNS 兼容脚本在 CIM 返回 84 时跳过 IPv6，适配器仍被记成成功 | fixed(36844a4a) | [#849](https://github.com/raydocs/tono/issues/849)，[#868](https://github.com/raydocs/tono/pull/868) | 低·推导 | 已合 main：IPv4 返回 84 只清掉 IPv4 期望，随后仍配置 IPv6。未实机 |
