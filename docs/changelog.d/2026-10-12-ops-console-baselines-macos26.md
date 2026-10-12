## 2026-10-12 · ops 控制台截图基线改在 `macos-26` 上重录（#1543）
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），A25 / D9-A 的剩余限制（[2026-10-10-ci-speedup](2026-10-10-ci-speedup.md)）：nightly 每晚 110 个像素对比失败。
- 来源：main `190d5166` → 分支 `fix/ops-console-baselines`；未合 main。
- 缺陷修复：无产品改动。
- 新增/优化：无。
- 工程与测试修正：`services/ops-console/e2e/__screenshots__` 里 107 张基线按托管 `macos-26` + Playwright 1.64 的渲染重录，补上 `nodes.spec.ts/dashboard.png`（light、dark）两张缺失基线。
  旧基线是 9 月 30 日在老板 Mac 上录的；之后控制台改版（业务导航、单一控制台、节点仪表盘、负载四宫格等）和 Playwright 1.63→1.64 都没有重录，
  因为 PR 门是 `--ignore-snapshots`。110 个失败全是像素差异（另 2 个缺基线），没有功能断言失败。
  重录方法：临时分支 `tmp/regen-ops-console-baselines` 上让 `screenshots-nightly.yml` 的 ops 任务跑 `--update-snapshots`
  并上传 `__screenshots__`（[run 38214953070](https://github.com/raydocs/tono/actions/runs/38214953070)）；该分支不合入。
- 验证：同一 runner 两次运行间 `light/ledger.spec.ts/ledger-empty.png` 逐字节相同；差异最大的两张（dense-table 0.78、node-detail load 0.47）逐张看过，是节点仪表盘和负载四宫格改版，不是页面损坏。本 PR 分支上的 nightly 结果见 PR。
- 候选/发布：无。
- 浅色账目页（`light/ledger.spec.ts/ledger.png`）：`--update-snapshots` 在 `macos-26` 上每次都停在 Playwright 的 "waiting for fonts to load"
  （5 s 和 60 s 期望超时都一样，[run 38216428202](https://github.com/raydocs/tono/actions/runs/38216428202)、[run 38216716260](https://github.com/raydocs/tono/actions/runs/38216716260)），
  但普通对比模式下能截到稳定图（"captured a stable screenshot"，[run 38217020253](https://github.com/raydocs/tono/actions/runs/38217020253)）。
  这张基线取自那次稳定截图，看过，是改版后的账目页。卡住只出现在重录模式里，不影响 nightly 的对比。
- 剩余限制：逐张视觉核对是 UI 判断，留给所有者在 PR 的图片 diff 里看。以后再在 `macos-26` 上重录时，浅色账目页可能还会卡住，可以照这次的办法从对比运行里取稳定截图。
