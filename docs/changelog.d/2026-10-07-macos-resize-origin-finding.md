## 2026-10-07 · macOS R1426 resize 原点修复（独立 finding PR）
- Plan: SHIP_PLAN §2 item 10；从mainf2cb79522分支，仅修R1426-opus-F1 = R1426-codex-F1同一缺陷，不混入已搁置B/#1429的面板/控件。
- 缺陷修复：缓存scene树的anchorPoint对齐(0,0)布局原点，live resize放大/缩小不露底并避免最终重建复位；原树复用、150ms去抖、相位/时钟不变。
- 工程与测试：一条真实CALayer转换覆盖XCTest，同时检查放大/缩小的bounds及重建后的identity；B同源码首修21cd5dac/run37602601403通过643tests/1skip/0fail，但这不是本新main/head的结果；未运行旧码红，不声称红→绿。
- 验证：MacBook原生XCTest不运行；新head hosted CI和jev-route评审待验。本地git diff --check exit0。
- 限制：只交源码PR，不合并、不签名、不打tag、不发布、不装机；真机窗口/签名候选验收仍留G1；两个finding在实际合main前保持in-PR。
- 署名：OpenAI Codex。

- 2026-10-07 续记：修复 PR [#1440](https://github.com/raydocs/tono/pull/1440)，源码 head db5cf811；[ci-gate 37692438650](https://github.com/raydocs/tono/actions/runs/37692438650) completed/success，macos/build success。Jev 4a8c1f76 完成无阻断；实际 Codex finder 被路由降到 medium，因此仍需独立 gpt-6.1-sol/high 补审。此次只补 PR 链接/验证状态，不改源码。
