| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-FIRST-CONNECT-503 | 首次连接遇到 HTTP 503 会失败并清掉连接意图，VPN 进程异常退出没有通知，底层网络用 null 表示系统默认 | in-PR | 本 PR | 中·连接 | `EXIT_IDENTITY_PROPAGATING` 仍由原 15 秒等待负责；未做真机 503 |

退避是 1s/2s/4s。耗尽后保留 `wantConnected`，下一次服务启动可以自己再连。用户主动断开和撤销同意不重复发停止通知。
