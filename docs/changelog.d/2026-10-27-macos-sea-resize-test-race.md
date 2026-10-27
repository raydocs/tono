## 2026-10-27 · macOS 海景缩放防抖测试去掉固定等待
- 归属：G1 回归保障（CI 稳定）；macOS `TonoTests/SeaScenePaletteTests.swift`，仅测试。
- 来源：基线 origin/main；分支 `test/sea-resize-debounce-wait`。
- 缺陷修复：无产品缺陷。MAC-SEA-RESIZE-TEST-RACE：固定 300 ms 等待改为最多 10 s 的有界轮询等重建，断言不变（仍要求重建、370×132、无残留变换）。
- 新增/优化：无。
- 工程与测试：见 PR 验证评论（失败日志、注入 200 ms 主 actor 卡顿的对照实验、ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机；未改 `SeaSceneLayerView.swift`。
