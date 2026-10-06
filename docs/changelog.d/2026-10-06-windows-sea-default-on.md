## 2026-10-06 · Windows 新外观 PR 12：默认开启
- 归属：`docs/SHIP_PLAN.md` 0.0.75；[决策 065](../decisions/065-2026-10-06-sea-appearance-on-by-default-in-0075.md)（老板 2026-10-06：「授权你合并 新外观开」）。stacked on #1414。
- 来源：`8d337686` → 本 PR head，`claude/windows-ui-pr12-default-on-20261006`；未合 main。
- 缺陷修复：无。
- 新增/优化：没有存过选择的设备启动即为新外观（`appearance-preferences.ts` 与 `index.html` 的首帧标记同一口径：只有明确存了「关」才是旧外观；
  本地存储读不出或损坏时也是新外观）。设置里的开关保留，文案由「新外观（预览）…默认关闭」改为「新外观…关闭后回到旧外观」。
  0.0.75 中英文发布说明加一条新外观说明。处理函数、保护/连接/路由语义、native 均未改。
- 工程与测试：一条回归（`gives a fresh install the new appearance and keeps an explicit off`）在旧源码上实跑 `expected false to be true`，改后通过。
  8 个覆盖旧外观的测试文件原先靠「默认关」取得旧外观，现在在各自的 `beforeEach` 里明确选旧外观（`sea-home` 的一条改为明确存「关」）；断言未改。
  `appearance-preferences.test.ts` 里原先断言默认值为关的一行按新决定改为开。
- 验证：MacBook，`vitest run` 全量 `Test Files 55 passed (55) / Tests 379 passed (379)`；typecheck `79 (baseline 79)`。exact-head ci-gate 见 PR。
- 候选/发布：仅源码。冻结源码 `e28ca45c` 与 7501 候选不含本改动，需重新冻结、重出候选并由老板对新包做 G1/G2。
- 剩余限制：未在 Windows/WebView2 真机验证；弱机上的海景开销未测，只有自动降档兜底。macOS 默认值不在本 PR。
  biome 在 `activity.test.tsx`（格式）与 `support.test.tsx`（非空断言）上的报告在本 PR 之前已存在，未动。
