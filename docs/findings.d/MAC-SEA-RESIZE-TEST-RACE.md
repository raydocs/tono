| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SEA-RESIZE-TEST-RACE | `SeaScenePaletteTests.testResizeReusesTheTreeUntilLiveResizeEndsOrLayoutSettles` 用固定 300 ms 等待 150 ms 的主 actor 防抖重建；托管 runner 卡顿时防抖任务的启动排在其它主 actor 工作之后，测试先醒来看到拖动时的旧烘焙（350×121），间歇失败 | in-PR | 本 PR | 低·已确认（CI 失败日志 + 注入卡顿实验） | 产品代码未改；真实窗口缩放与全屏切换未在实机复测 |
