| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-DOWNLOAD-NO-RESUME | Windows 安装包下载开始后，任何中断（连接重置、换网、睡眠唤醒、600 s 单请求上限）都让整次安装失败，下次从第 0 字节重下；也没有空闲超时，断掉的链路要等满 600 s 才失败 | in-PR | 待开（`amp/win-update-download-resume`） | 中·推导（代码阅读 + 回归测试模拟，非现场） | 修复后：60 s 无字节即视为中断（与 macOS 一致），从已写字节用 `Range` 续传，经同一路径链（先走 API 最近走通的中继），最多 3 次；续传应答必须是该偏移的 206，否则失败。Service 照旧校验大小与 SHA-256。下载失败时的残留文件与「取消」不中止下载另记 [WIN-UPDATE-PARTIAL-FILES](WIN-UPDATE-PARTIAL-FILES.md) |
