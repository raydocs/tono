| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-UI-1 | iOS 海面场景 30 Hz TimelineView 除减少动态效果外没有任何暂停条件，应用非活跃、Sheet 遮住首页、低电量模式、热压力下仍持续重绘 | in-PR | 待开 | 高·实测代码 | 待实机：低电量模式、热压力、Sheet 下的电量/帧率对比；前台画面与四档画质不变 |

修复：`SceneAnimationPolicy`（TonoKit）在应用非活跃、Sheet 遮住首页、低电量模式、热状态 serious/critical 时让 `SeaScene` 停在最后一帧；前台效果、星空、云、流星、颗粒、水面与减少动态效果行为不变。
