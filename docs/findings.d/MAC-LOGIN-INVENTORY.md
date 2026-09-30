| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LOGIN-INVENTORY | macOS 邮箱验证成功后仍同步等待独立的设备清单 GET；清单暂时返回 503 会把有效登录送回错误门，而云出口登录已有验证响应中的用户和本机设备 | fixed (ca1dd8ac) | [#689](https://github.com/raydocs/tono/pull/689) | 中·已确认 | 改前25350e10 CI36682380427实际449 tests/1 failure，唯一失败为新登录回归；改后c09417d7 CI36682656707四 jobs通过，独立Codex high无发现。无客户日志或实机复现；仅覆盖独立inventory503失败路径 |

基线 b9c50b60：`AccountSession+Auth.swift:330-335` 邮箱验证码走 `authenticate`，`TonoAPIClient.swift:238-239` 接受 Worker `auth/email/verify` 的 200 验证响应；`AccountSession+Auth.swift:847-857` 随即 `try await reloadDevices()`，其独立 GET 抛 503 时落入 `:884` 的 `fail`，`AccountSession+Telemetry.swift:560-562` 把状态设为 `.error`。Worker `index.ts:2306-2333` 在验证成功后已返回 user/device/token，`/devices` 是另一请求。云出口启动恢复在 `AccountSession+Auth.swift:55-74` 已把设备清单放到 Ready 后后台读取。修复仅将云出口新登录的设备清单读取移到 Ready 后，保留 Home 分支、会话拒绝裁决与账户门控。
