| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-INITIAL-DATA-DOUBLE-APPLY | 第二个主窗口的 scene task 会在第一次 `loadInitialData` 挂起之后再应用一遍磁盘快照；目录安装失败时会清掉非 custom 节点 | in-PR | 待开 | 低·推导 | `allowRuntimeTransition` 仍是 false，这条路径本身不武装 PF |

`WindowGroup` 的每个窗口都跑 `.task` 里的 `loadInitialData`。磁盘读取已经共用一个 `Task`，但「只应用一次」的判断写在 `await loadTask.value` 之后，两次调用都能过。第二次安装若在 `validate` 上失败，catch 会 `proxyRegions.removeAll`。
