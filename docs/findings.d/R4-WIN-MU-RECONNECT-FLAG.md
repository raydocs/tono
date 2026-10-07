| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-MU-RECONNECT-FLAG | 崩溃窗口释放后的重连标志不带 owner，另一个已登录用户的 App 会用自己的账号自动连接并接管，原用户重连得到 1014 | in-PR | [#1291](https://github.com/raydocs/tono/issues/1291)，[#1450](https://github.com/raydocs/tono/pull/1450) | 中·推导（P2，读码；谁先重连是推断） | 重连标志绑定被释放会话的 owner（决策 075，provisional）；升级前无 owner 的崩溃墓碑不再自动重连；双账号实机未验证 |
