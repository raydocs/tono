| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| LOGIN-LOG-UPLOAD-COPY | macOS 与 Windows 首登页承诺"流量日志不会上传，除非你在设置里打开"，而新安装默认开启上传（`networkLogUploadDefault = true`、`NETWORK_LOG_UPLOAD_DEFAULT = true`，决定 076 服务端默认存储主机名/进程 14 天、汇总 90 天）：公开付费上线前的隐私告知与实际行为相反 | fixed(eb8909bd3) | [#1556](https://github.com/raydocs/tono/issues/1556) / [#1557](https://github.com/raydocs/tono/pull/1557) | 中·读码（CI 截图 renders/login-sea-email-native-window.png @dfb06df7 实见原句） | 只改告知文案，不改默认值（决定 076 为所有者决定）；未观测到告知之外的上传；待实机（2026-10-11 汇总：无签名设备 / 国内家宽证据） |

来源：付费上线只读审计（Puck 委派，2026-10-10），绑定 origin/main `a6ef4580`。修复：两端首登中英文告知改为"默认上传、数据范围、可在设置里关闭"，与设置页说明一致。
