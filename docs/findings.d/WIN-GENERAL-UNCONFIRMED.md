| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-GENERAL-UNCONFIRMED | Windows 通用设置读取未完成仍可修改，开机自启和语言提前显示更改，失败时猜测回滚且不提供可信重新读取 | in-PR | 本 PR，`amp/settings-flow-consistency` | 低·已复现（生产 UI/hook、模拟原生 IO） | 回归先失败后通过；原生 setter/登录项/持久化未改，实际 Windows WebView2、IPC 及磁盘失败仍待最后候选包验收 |

原生 preferences setter 可以在应用 OS 行为后、文件保存或回执阶段失败；UI 不能据此假定回滚成功。
保留原生调用，等成功及读回匹配才确认；共享操作状态跨页面保留，失败后只通过成功读取恢复写入。
