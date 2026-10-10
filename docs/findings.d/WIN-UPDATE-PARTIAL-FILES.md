| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-PARTIAL-FILES | Windows 更新下载失败时 `update-downloads/<nonce>.exe` 半截文件不删，成功交给 Service 后的副本也不删；更新对话框的「取消」只关窗口，不中止后台下载（`update-viewer.tsx` `onCancel`） | open | 无修复 PR（中国大陆连通性审计 2026-10-10 记录） | 低·推导（代码阅读） | 后果是磁盘上堆积安装包大小的文件、取消后下载仍占用链路；不影响签名校验或保护；未修 |
