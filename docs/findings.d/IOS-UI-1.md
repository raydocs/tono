| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-UI-1 | iOS 海面场景 30 Hz TimelineView 除减少动态效果外没有任何暂停或降帧条件，应用非活跃、全高 Sheet 遮住首页、低电量模式、热压力下仍按满速重绘 | in-PR | #1810 | 高·实测代码 | 待实机：低电量模式、热压力、Sheet 下的帧率与电量对比，暂停后恢复 |

修复：`SceneAnimationPolicy.frameInterval`（TonoKit）。前台可见时 30 Hz；低电量模式、热状态 serious 时 15 Hz，动效不停；应用非活跃、设置/VPN 引导全高 Sheet、热状态 critical 时停在减少动态效果的静态帧。半高线路/详情 Sheet 下继续动。场景元素不删不减。
