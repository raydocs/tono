| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1426-opus-F1 | 调整尺寸期间 sublayerTransform 以新 bounds 的中心缩放旧原点布局树，放大露出右/下底色、缩小露出左/上底色，重建时复位 | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426)；修复 [#1440](https://github.com/raydocs/tono/pull/1440) | 低·已确认 | 从mainf2cb79522独立移植scene.anchorPoint=.zero并保留树复用/去抖；新增真实CALayer放大缩小覆盖窄回归。B/#1429已搁置，本修复走独立 #1440；db5cf811 源码 CI37692438650 成功，3a6bb573 CI37694685899 的原点回归通过但旧 backing-scale 回归失败，本轮源码续修后 CI 待验，未合main/未实机，不提前填fixed。 |

- 来源：[jev-route7957497e原始评审记录](https://github.com/raydocs/tono/pull/1426#issuecomment-6034844744)，源码4570901eb，SeaSceneLayerView.swift:100；minor，另一方复核确认。两条是同一缺陷，不重复计数。
