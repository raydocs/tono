| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-SUSPENDED-SUCCESSOR | 更新恢复把从未 Resume 的挂起后继进程当成成功，服务保持停止 | in-PR | [#847](https://github.com/raydocs/tono/issues/847) | 中·推导 | 线程挂起计数是 Win32，本环境只跑了恢复决策测试。Resume 失败时服务会起来，屏障保持启动期阻断，直到用户打开 App |
