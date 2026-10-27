## 2026-10-26 · macOS 未武装重连测试不再断言探测顺序
- 归属：G3（macOS 客户端）测试；`apps/macos/TonoTests/ArmedFailureReleaseTests.swift`。
- 来源：基线 main `b138f87b1` → 分支 `fix/macos-unarmed-proof-order-test`。
- 缺陷修复：#1767 让未武装重连并行探测所有候选节点，结果仍按偏好顺序取胜；`testADeadHy2SelectionReconnectsOnTheSameNodesRealityBlock` 仍断言「同节点 Reality 块第一个被探测」，并行后探测的调用顺序不再确定，PR #1771 的 macOS 单元测试因此失败（得到 Mesa，期望 Canyon）。改为断言该 Reality 块被探测过；拨号目标仍是它（`admittedName`）和 hy2 块从不被探测这两条断言不变。
- 验证：仅改测试与注释；依赖 PR 上 `macos-ci.yml`。
- 剩余限制：无。
