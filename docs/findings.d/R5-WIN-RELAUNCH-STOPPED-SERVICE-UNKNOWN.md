| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN | 未连接退出后 Service 经 owner-goodbye 自停，不重启电脑直接重开 App：启动保护探测无应答记为 Unknown→armed，界面停在「保护未知 / Protected Offline」且不提供 Connect，Service 轮询永远读不到；下一次退出走显式释放，`--start-registered` 弹 UAC | open | [#1300](https://github.com/raydocs/tono/issues/1300) | 低·已确认（P2，读码） | 不断网、不泄漏。Unknown→armed 是有意的保守选择（持久 WFP 底座使「Service 已停」不能证明无屏障）；区分干净 goodbye 与崩溃需要 Service 侧证据，待所有者决定 |
