| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1426-codex-F1 | 复用海景树时只设置缩放而未补偿中心缩放的原点偏移，窗口调整尺寸露底且最终重建跳回（同 R1426-opus-F1） | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426)；修复 [#1440](https://github.com/raydocs/tono/pull/1440) | 低·已确认 | 从mainf2cb79522独立移植scene.anchorPoint=.zero并保留树复用/去抖；新增真实CALayer放大缩小覆盖窄回归。B/#1429已搁置，本修复走独立PR（创建后补链接）；精确head托管/评审待验，未合main/未实机，不提前填fixed。 |

- 来源：[jev-route7957497e原始评审记录](https://github.com/raydocs/tono/pull/1426#issuecomment-6034844744)，源码4570901eb，SeaSceneLayerView.swift:102；minor，另一方复核确认。两条是同一缺陷，不重复计数。
