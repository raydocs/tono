| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-STATUS-RESUME-CALLBACK | UI 暂停前的旧 listener 回调跨恢复投递时缺乏订阅代际校验，可覆盖新状态 | in-PR | [#1673](https://github.com/raydocs/tono/pull/1673) | 中·推导 | 工作区补 callback epoch 和单条 Robolectric 回归，尚未运行/推送；无设备复现证据 |

回归：`EngineClientTest.aCallbackRetainedAcrossPauseCannotReplaceTheFreshResumeSnapshot`。状态模型的 session/dead 集不足以覆盖未收到死亡回调的订阅更替；源码检查后补齐订阅隔离。
