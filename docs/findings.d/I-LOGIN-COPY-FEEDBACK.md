| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-LOGIN-COPY-FEEDBACK | 登录诊断复制包含完整邮箱，Mac 忽略剪贴板失败却提示已复制 | in-PR | amp/login-cleanup | 中·推导 | Windows 合成 IPC/剪贴板回归通过；Mac native 与真实 OS 剪贴板拒绝待验 |

源证据：基线 `AccountGateSupport.swift` 的 `copyDetails` 将 `Email:` 拼入文本，忽略 `NSPasteboard.setString` 的 Bool 后无条件显示 Copied；Windows `SupportContact` 拼入 email 与任意 extra。新实现只保留 allowlist，点击后检查写入结果并提供失败反馈/安全手动兜底。不声称已在真实设备复现剪贴板拒绝，不读取用户已有剪贴板。
