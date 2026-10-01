| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-SUSPENDED-SUCCESSOR | 更新执行器在 Resume 之前被 abort 或外部结束时，恢复把从未运行的挂起进程当成成功，服务保持停止 | open | [#847](https://github.com/raydocs/tono/issues/847) | 中·推导 | 判断线程从未 Resume 需要 Win32，本环境没有测试 |
