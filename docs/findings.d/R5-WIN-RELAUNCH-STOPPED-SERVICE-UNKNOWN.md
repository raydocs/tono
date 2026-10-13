| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN | 未连接退出后 Service 经 owner-goodbye 自停，不重启电脑直接重开 App：启动保护探测无应答记为 Unknown→armed，界面停在「保护未知 / Protected Offline」且不提供 Connect，Service 轮询永远读不到；下一次退出走显式释放，`--start-registered` 弹 UAC | in-PR | [#1300](https://github.com/raydocs/tono/issues/1300)，[#1624](https://github.com/raydocs/tono/pull/1624) | 低·已确认（P2，读码） | 决策 114（provisional）：Service 写易失“干净 goodbye”记录，App 在 Stopped + 记录时读作已证明无屏障；崩溃仍是 Unknown→armed；注册表记录与 SCM 判断未在实机验证 |
