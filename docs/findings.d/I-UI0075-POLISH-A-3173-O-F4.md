| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-UI0075-POLISH-A-3173-O-F4 | 跨不同缩放显示器后海景保持旧像素烘焙和 contentsScale | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426) | 低·已确认 | 尺寸+backingScaleFactor 同为缓存键，NSView backing 回调触发布局；包括 gradient/mask/dot 的 scale，真实层/纹理尺寸回归待 CI，非真机多屏。 尚待最终 head 增量生命周期复审，不凭源码关闭。 |

- 来源：jev-route `3173f320` 对 `82b91e635` 的 opus:F4；同修 codex:F2，PR 原始评审记录；一轮修复，不是 owner 真机验收。
