## 2026-10-27 · macOS：原生 Apple 登录移出 DEBUG，外部邮箱的 Apple ID 经确认后用验证码关联
- 归属：用户决定（正式版支持 Apple 和 Google 登录）；决策 141 的 macOS 客户端部分。依赖 #1795（服务端票据）与 #1783（本分支的基线）。
- 来源：`feat/apple-signin-public-signup` → 分支 `feat/macos-apple-signin-release`；未合并，没有新的客户端包。
- 新增/优化：Apple 登录按钮在服务端 `apple.enabled` 且本构建签名确实带 `com.apple.developer.applesignin` 时显示（Release 的 `Tono-Release.entitlements` 目前为空，所以正式包在负责人配好 Developer ID 描述文件和权限前不显示按钮）。服务端返回 `EMAIL_OWNERSHIP_UNVERIFIED` 时提示改用该邮箱的验证码，并询问「要把 j•••@x 的 Apple ID 关联到你用邮箱验证码登录的 Tono 账户吗？」；只有点「关联 Apple ID」后，且验证码邮箱与 Apple 给的邮箱一致、10 分钟内，才把票据随验证码发送。票据只在内存里，取消、换邮箱、退出账户或用过一次即丢弃。`OIDC_AUTHENTICATION_FAILED` 和 `IDENTITY_PROVIDER_UNAVAILABLE` 不再显示为「会话已过期」或原样英文。Google 仍只在 DEBUG。
- 工程与测试：新增 `testIdentityLinkTicketNeedsConsentTheSameAddressAndTenMinutes`；15 条新文案加入中英文。
- 验证：只有托管 CI（macos-26）。orb 是 Linux，没有 Swift，也无法截图。
- 剩余限制：关联结果（linked / conflict）尚未在登录后的界面显示；取消 Apple 面板目前显示「已取消登录」错误行；需要真机验证 Apple 面板、隐藏邮箱和描述文件。UI 改动，需负责人看图后合并。
