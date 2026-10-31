| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| AND-UI-01 | Android 海面场景的无限环境动画（漂移 26 s、呼吸 2.4 s）在所有状态下每帧重绘画布，背景录制与所有模糊玻璃随屏幕刷新率重绘，除系统「移除动画」外无任何停止条件 | in-PR | fix/android-scene-energy-20261031 | 高·实测代码 | 待实机：帧率与功耗对比；前台可见时未加帧率上限（保持原观感） |

修复：环境动画改为自有帧时钟，由 `SceneAnimationPolicy` 决定全速、约 15 fps 或停住；Activity 低于 STARTED 或热状态 CRITICAL 及以上时停在与减少动画相同的静帧。回归：`SceneAnimationPolicyTest`。
