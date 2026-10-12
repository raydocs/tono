## 2026-10-12 · 运维台：手机上客户端页「版本分布」表放得进卡片，不再在卡片里横向滚动
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基于 `feat/ops-customers-phone-fixes`（99e8046a9，已含 main）→ 分支 `fix/ops-clients-phone-version-table`；未合 main。
- 缺陷修复（main 上就有，见基线 `clients-phone/clients.png`）：客户端页 390 px 下「版本分布」表在右缘被截：「落后一版」表头顶着卡片右缘，下面的数值（0、5）只剩左半。原因是 `clients.css` 里 `.clients-matrix table { min-width: 600px }`：表有五列（平台 + 最新 / 落后一版 / 落后两版以上 / 未上报），350 px 的卡片只露出前三列，其余在卡片自己的 `overflow-x-auto` 里滚动。
- 改动：`src/styles/clients.css` 的 ≤640 px 规则里，表去掉 600 px 下限、改 `table-layout:auto`（和 `.nodes-table` 一样按内容收缩），单元格左右内边距 6 px、`white-space:nowrap`（表头不会在词中折行），首列 `width:1%`；五列合计约 348 px，正好在卡片内，卡片里没有横向滚动。平台列靠左，三个数字列靠右（原有的 `text-right`），数字沿用 `tabular-nums`。桌面（≥641 px）不变，仍是 600 px 下限与 `table-fixed`。
- 工程与测试：`e2e/clients-phone.spec.ts` 新增一例：「版本分布」表每个单元格（表头与数据）`right ≤ 卡片 right + 0.5` 且 `scrollWidth ≤ clientWidth`，卡片自己的 `scrollWidth ≤ clientWidth`，「落后一版」表头完整在视口内；在旧代码上该例失败（「落后一版」右缘 381，卡片右缘 370）。
- 验证（本机，`services/ops-console`）：typecheck、vitest、eslint、build、Playwright（clients、pages-phone、states，`--ignore-snapshots`）结果见交付报告。
  会变的截图基线（本提交没有重录，需要在 CI 里重录）：`clients-phone/clients.png`（light 与 dark 各一张）。
- 候选/发布：无新包，仅源码。
