| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-RETRY-DEFAULT-OPEN | Windows 更新失败后默认还能再点「现在更新」，needs-attention 和 network protection 拒绝被当成下载失败 | in-PR | fix/t7-update-prep | 中·已确认 | 只有带 `TONO_UPDATE_DOWNLOAD_FAILED` 的下载传输失败可以重试。本机未跑 cargo。未上真机 |

每次再点都会清代理、作废连接，并再走一次 Prepare。Prepare 失败后的清理还可能放行一般流量。下载失败由 App 在 Prepare 之前打上标记；Service 拒绝没有这个标记。
