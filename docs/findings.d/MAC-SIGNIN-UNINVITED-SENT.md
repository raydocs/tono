| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SIGNIN-UNINVITED-SENT | macOS 登录对任何邮箱都说「请查看 \(email) 里 Tono 发来的邮件」，未受邀邮箱永远收不到码却被这样承诺；邮件服务商故障时一分钟后的提示也只让查垃圾箱 | in-PR | 本 PR（`feat/apple-signin-public-signup`） | 中·已确认（代码阅读：LoginView 文案，control-plane `eligible`） | 未在真机或截图上验证（Linux orb 无法渲染 SwiftUI）；需要 #1781 部署后才有 `deliveryDegraded`；Android 未改 |

Windows 同类问题见 WIN-SIGNIN-UNINVITED-SENT（#1778）。iOS 原本就用条件式文案，本 PR 只补上开放注册、发信异常和 `ENTITLEMENT_REQUIRED` 的提示。
