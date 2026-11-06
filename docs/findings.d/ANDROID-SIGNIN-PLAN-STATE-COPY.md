| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-SIGNIN-PLAN-STATE-COPY | Android（apps/android/mobile）把 403 `ACCOUNT_EXPIRED` / `QUOTA_EXCEEDED` / `ENTITLEMENT_REQUIRED` 显示成「登录未完成（CODE）」或「出了点问题（CODE）」；输入验证码那一步不区分开放注册、当日名额已满和邀请制，也没有发信异常提示 | in-PR | 本 PR（`feat/android-signin-public-signup`） | 中·已确认（代码阅读：Text.kt `signInError` / `reasonText`，TonoVpnService `startEmail`） | Android 不进当前这一发（SHIP_PLAN「明确不进这一发」）；未在真机上验证；发信异常只在请求验证码时读取，等待期间不会再读 |
