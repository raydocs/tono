| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-UI0075-POLISH-A-3173-O-F1 | 窗口连续调整尺寸逐帧重建海景树并重烘焙纹理 | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426) | 低·已确认 | resize 缓存复用到 live-resize 结束；其它连续布局 150ms 去抖。拖拽中临时缩放旧树，结束后重烘焙；实际尺寸/树 identity XCTest 待 CI。 尚待最终 head 增量生命周期复审，不凭源码关闭。 |

- 来源：jev-route `3173f320` 对 `82b91e635` 的 opus:F1，PR 原始评审记录；一轮修复，不是 owner 真机验收。
