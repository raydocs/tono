| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1255 | macOS 原生更新 prepare 失败后界面一直显示 Blocked，直到 Connect / 恢复网络 | refuted | [#1255](https://github.com/raydocs/tono/issues/1255)，[#1254](https://github.com/raydocs/tono/pull/1254) | 低·推导 | 符合更新合约：prepare 失败时 `UpdateTransaction.prepare` 以 `preparationFailed` 阻断，attempt 保持待处理，恢复走更新的 Disconnect / Retry；网络不被应用切断。原报告把它写成 UI 缺陷是高估 |
