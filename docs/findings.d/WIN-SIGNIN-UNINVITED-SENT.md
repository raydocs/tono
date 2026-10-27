| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SIGNIN-UNINVITED-SENT | Windows 登录对未受邀邮箱也说「请查收邮件」，一分钟后只建议看垃圾箱或重发，用户收不到码却不知道原因（服务端为防枚举对所有地址都回 202，只给合格邮箱发信） | in-PR | 待开（叠在 #1777 上） | 中·已确认（代码阅读：control-plane index.ts `eligible`，login.tsx 文案） | 只改 Windows en/zh 文案；macOS（LoginView「Check \(email)…」）与 iOS 未改；公开注册开关（`auth/methods` 的 `email.publicSignup`）Windows 尚未读取 |
