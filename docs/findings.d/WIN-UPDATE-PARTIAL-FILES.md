| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-PARTIAL-FILES | Windows 更新下载失败时 `update-downloads/<nonce>.exe` 半截文件不删，成功交给 Service 后的副本也不删；更新对话框的「取消」只关窗口，不中止后台下载（`update-viewer.tsx` `onCancel`） | in-PR | 待开（`amp/win-update-partial-files`，叠在 #1527 上） | 低·推导（代码阅读） | 修复后：安装结束的每条路径（出错、取消、Prepare 返回后）删除本次的包；启动时在安装锁下清理本目录里早先留下的 nonce 命名包（不递归、不跟随链接、只删普通文件）；「取消」经取消令牌中止下载与续传；Prepare 之后不可取消。Service 仍被固定（pin）的文件删不掉时留给下次启动清理 |
