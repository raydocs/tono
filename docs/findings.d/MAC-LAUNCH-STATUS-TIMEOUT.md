| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LAUNCH-STATUS-TIMEOUT | 启动时 `/update/status` 连上但读超时（或写失败）不走「helper 没应答」的修复/提示，Retry 一直停在同一次失败，已武装的 PF 不会进入后续恢复 | in-PR | #840 | 中·推导 | 只把 connectFailed、emptyResponse、socketFailed 当没应答；403 和坏正文仍是应答 |

`queryPendingNativeUpdate` 原先只捕获 `HelperIPCError.connectFailed`。`/update/status` 的接收超时是 6 秒，超时在 `sendRequest` 里变成 `emptyResponse`。这是只读状态查询，丢失的回复不代表 helper 已经提交了变更。
