| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-FAKEIP-SERVICE-RESTART | Windows Service 自己用同一份文档重启 sing-box（看门狗重启、期望状态恢复、替换失败后还原上一份、重试回滚文档）时 fake-IP 槽位不变，新进程从同一段开头重新分配，应用缓存的旧地址对应到别的域名 | open | [#1258](https://github.com/raydocs/tono/issues/1258) | 中·推导 | [#1333](https://github.com/raydocs/tono/pull/1333) 只覆盖 App 编译新文档的替换；这些路径在 Service 里，改它要动特权路径和文档摘要，单独做 |

依据：`apps/windows/service/src/core/manager.rs`（看门狗重启当前文档）、`server/mod.rs`（期望状态恢复）、`sing_box_direct.rs`（替换失败后启动上一份文档、重试请求的回滚文档）都直接启动已保存的字节。sing-box alpha.9 的 fake-IP 表只在内存里，进程一换就从段首重新分配；地址落在当前槽位内，路由前被改写成新域名，池的拒绝规则不匹配。触发条件是 sing-box 进程崩溃或替换失败，比 #1333 修的「每次带 DIRECT 的 Connect」少见。Codex 第一轮评审（#1333）指出。
