## 2026-10-07 · macOS R1426 resize 原点修复（独立 finding PR）
- Plan: SHIP_PLAN §2 item 10；从mainf2cb79522分支，仅修R1426-opus-F1 = R1426-codex-F1同一缺陷，不混入已搁置B/#1429的面板/控件。
- 缺陷修复：缓存scene树的anchorPoint对齐(0,0)布局原点，live resize放大/缩小不露底并避免最终重建复位；原树复用、150ms去抖、相位/时钟不变。
- 工程与测试：一条真实CALayer转换覆盖XCTest，同时检查放大/缩小的bounds及重建后的identity；B同源码首修21cd5dac/run37602601403通过643tests/1skip/0fail，但这不是本新main/head的结果；未运行旧码红，不声称红→绿。
- 验证：MacBook原生XCTest不运行；新head hosted CI和jev-route评审待验。本地git diff --check exit0。
- 限制：只交源码PR，不合并、不签名、不打tag、不发布、不装机；真机窗口/签名候选验收仍留G1；两个finding在实际合main前保持in-PR。
- 署名：OpenAI Codex。

- 2026-10-07 续记：修复 PR [#1440](https://github.com/raydocs/tono/pull/1440)，源码 head db5cf811；[ci-gate 37692438650](https://github.com/raydocs/tono/actions/runs/37692438650) completed/success，macos/build success。Jev 4a8c1f76 完成无阻断；实际 Codex finder 被路由降到 medium，因此仍需独立 gpt-6.1-sol/high 补审。此次只补 PR 链接/验证状态，不改源码。

- 2026-10-07 CI 续修：3a6bb573 / run37694685899 原点回归通过，但 643tests/1skip/4fail 全是旧 backing-scale 回归的未重建/1×/320px 断言。像素密度通知改为当 scale 实际变化时同步重烘焙，不再挤入尺寸去抖；尺寸拖拽缓存/去抖和原点修复保留。原像素断言不放宽，删除测试等待300ms，直接核验通知后的真实 layer/image。新测试尚未运行；不声称新测试旧码红→绿。新 finding MAC-SEA-BACKING-REBAKE-DEFERRED in-PR，hosted CI/增量独立 high review 待验。

- 2026-10-07 density 增量复审（一轮）：e6a145ee / system Codex gpt-6.1-sol high 无 major、一个 minor：backing 回调可能先于布局，grain 读旧/零 scene.bounds。同步将 scene frame/flipped 更新到真实 view bounds 后再 rebake；新增一条真实窗口 pending-size + density 回归，检查 grain frame/720px 与后续 layout 复用。未执行旧码红测，hosted CI/该增量复审待验。
