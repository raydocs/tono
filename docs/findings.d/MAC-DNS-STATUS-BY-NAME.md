| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DNS-STATUS-BY-NAME | 受保护 DNS 的 status 仍按服务显示名读回；改名后报未配置，App 断开且 PF 保持 | in-PR | [#893](https://github.com/raydocs/tono/issues/893) [#979](https://github.com/raydocs/tono/pull/979) | 中·推导 | 有 serviceID 时按 ID 读，失败不退回显示名；没有 ID 的旧快照仍按名字；未实机 |
