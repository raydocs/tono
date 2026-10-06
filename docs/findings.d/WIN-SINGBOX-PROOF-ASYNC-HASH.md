| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-PROOF-ASYNC-HASH | Windows App 在异步线程上同步对约 35 MB 的 sing-box 镜像做整文件 SHA-256，且排在其他准备之后串行 | fixed(f26c57bd) | [#1418](https://github.com/raydocs/tono/pull/1418) | 低·推导 | 哈希移到阻塞线程并提前到 PrepareCoreStart 之前与 TCP 证明重叠；这份证明只选内核，Service 在 StartClash 内仍自行哈希并验签，所以提前测量不放宽准入；阻塞线程 panic 或被取消按未认证处理，读取本身无单独期限（与原来相同）；每次连接多出的那次 version IPC 未去重 |

来源：2026-10-04 连接速度审查 S4。见 [changelog](../changelog.d/2026-10-06-windows-connect-speed.md)。
