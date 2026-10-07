| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1426-codex-F1 | 复用海景树时只设置缩放而未补偿中心缩放的原点偏移，窗口调整尺寸露底且最终重建跳回（同 R1426-opus-F1） | open | [#1426](https://github.com/raydocs/tono/pull/1426) | 低·已确认 | left open by the jev-route stop rule after 1 fix round (7957497e); fix in package B first commit |

- 来源：[jev-route7957497e原始评审记录](https://github.com/raydocs/tono/pull/1426#issuecomment-6034844744)，源码4570901eb，SeaSceneLayerView.swift:102；minor，另一方复核确认。两条是同一缺陷，不重复计数。
