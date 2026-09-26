| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| TM-claude-1-native-update | 原生更新已验证断开与退役重试放开连接时不清 consecutiveProtectionRepairCount，旧修复计数带进下一次会话 | fixed(2ba08b9b) | [#601](https://github.com/raydocs/tono/issues/601)，[#649](https://github.com/raydocs/tono/pull/649) | 低·推导 | 无回归测试：两条路径直接走 helper IPC，无测试缝；Codex 发现，未经第二家验证 |
