## 2026-10-27 · macOS / iOS 登录：开放注册和发信状态的如实提示
- 归属：ops 任务（开放注册，决策 138）的客户端部分；macOS（`apps/macos`）、iOS（`apps/ios`）。Windows 在 #1778，由 UI 线程负责。
- 来源：origin/main `df0c0322a` → 分支 `feat/apple-signin-public-signup`；未合 main，没有新的客户端包。
- 缺陷修复：macOS 输入验证码那一步不再对每个邮箱都承诺「去收件箱查看邮件」：`publicSignup` 为 true 时写「已申请验证码，通常一分钟内送达」，否则用条件式文案。iOS 原本就用条件式文案。见 MAC-SIGNIN-UNINVITED-SENT。
- 新增/优化：两端都读取 `auth/methods` 的 `email.publicSignup` 和 `email.deliveryDegraded`（全局状态，与具体邮箱无关；旧服务端不返回时按 false 处理）。等待验证码时（macOS 在 60 秒提示时重新读取，iOS 进入这一步时和 60 秒后各读一次），如果服务商出错，就提示「邮件服务暂时异常，验证码可能延迟或收不到，请过几分钟再试」。登录时遇到 403 `ENTITLEMENT_REQUIRED`，两端都显示「账号已建好，但还没有开通套餐。请联系 Tono 开通后重新登录」，不再显示「账户未启用」或「登录未完成（ENTITLEMENT_REQUIRED）」。中英文都有。
- 工程与测试：macOS 新增 `testSignInMethodsCarryTheGlobalMailState`，并扩展 `testNewAccountCodesRemainEntitlementRefusals…`；TonoKit 新增 `testEmailSignInStatusReadsTheGlobalMailState…`。
- 验证：只有托管 CI（macos-26 XCTest 与 iOS 工作流）。orb 是 Linux，没有 Swift，也无法渲染界面。
- 候选/发布：仅源码。
- 剩余限制：没有截图，也没有真机验证；属于 UI 改动，需要负责人看过界面才能合并。macOS 在登录时遇到 `ENTITLEMENT_REQUIRED` 会进入已有的「This Tono account cannot connect」页面（与登录时遇到 `ACCOUNT_EXPIRED` 的路径相同），页面上的说明改为新文案。Android 未改。

2026-10-27 续：跟随 #1786 的契约，区分「开放注册当日名额已满」（`signupPaused`）和邀请制（`publicSignup` 为 false）。名额已满时，两端写「如果该邮箱已经可以登录，验证码正在发送……今天的新用户注册名额已满，新用户请明天再试」。邀请制和读取失败时仍用条件式文案，任何状态下都不写「邀请制」。测试中的 methods 增加了 `signupPaused`。
