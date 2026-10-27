## 2026-10-27 · Android 登录：开放注册状态和套餐状态的提示
- 归属：ops 任务（开放注册，决策 138）的 Android 部分；`apps/android/mobile`。Android 仍不进当前这一发（SHIP_PLAN「明确不进这一发」）。
- 来源：origin/main（#1786 之后）→ 分支 `feat/android-signin-public-signup`；未合 main，无新包。
- 缺陷修复：登录或刷新目录时遇到 403 `ACCOUNT_EXPIRED`、`QUOTA_EXCEEDED`、`ENTITLEMENT_REQUIRED`，原来显示通用的「登录未完成（CODE）」或「出了点问题（CODE）」，现在分别显示套餐已到期、流量已用完、「账号已建好，但还没有开通套餐」。见 ANDROID-SIGNIN-PLAN-STATE-COPY。
- 新增/优化：验证码请求返回的 202 里有 `publicSignup`、`signupPaused`、`deliveryDegraded`（全局状态）。据此，输入验证码那一步分为开放注册（「已申请验证码」）、当日名额已满（条件式文案加「新用户请明天再试」）和邀请制或旧服务端（原条件式文案），发信异常时多一行提示。中英文都有。
- 工程与测试：`EngineUnitTest` 新增 `codeRequestReadsTheGlobalRegistrationState…`，扩展快照跨进程往返的测试，覆盖新增字段。
- 验证：android-ci（JVM 测试）在 PR 上跑；orb 没有 JDK 和 Android SDK，本地没有运行。
- 剩余限制：没有截图，也没有真机验证。等待期间不会重新读取发信状态（iOS 和 macOS 会在 60 秒时再读一次）。
