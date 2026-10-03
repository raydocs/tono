| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-1256 | macOS sign-in screen keeps its controls enabled while sign-out or Restore internet cleanup runs, so a sign-in submitted then is silently dropped by the account cleanup barrier | fixed(cff0b3ca) | [#1256](https://github.com/raydocs/tono/issues/1256), fix/mac-1256-signin-during-cleanup | 低·已确认（P3，UI） | The barrier still drops a late submit by design; the screen now disables its controls while cleanup runs. XCTest runs on hosted CI only. |
