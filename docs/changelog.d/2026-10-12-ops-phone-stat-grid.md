## 2026-10-12 · 运维台：手机上的数字块两列排
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `feat/ops-maturity-r1`（叠在其上，合入顺序：先 `feat/ops-maturity-r1`）→ 分支 `ui/ops-phone-stat-grid`；未合 main。
- 缺陷修复：手机（390 px）上客户详情的「这月实际体验」四个数字一行一个、每个占满整行，这一块比需要的高约 4 倍；节点详情的数字块在手机上本来就是两列。
- 改动：共用类 `metric-band`（`src/styles/phone.css`，≤640 px：两列、间距 12 px 同节点详情数字块；末尾落单的一块占整行，同「质量」区做法）。桌面不变（仍是 4/5/3 列）。
  - 已改：客户详情「这月实际体验」（4 块，2×2）；设置 · 账目「这个月客户实际体验」（5 块，最后一块「有效覆盖」占整行）；设置 · 账目页顶的「收入 / 成本 / 毛利」（3 块，毛利占整行）。
  - 已核对、未动（手机上本来就是两列）：今天的四个 KPI（2×2）与「质量」区、节点列表与节点详情数字块、客户列表数字块、家宽「库存」「线路」数字块。
  - 未动：`Fact` 键值行（客户详情「现在」「账务」等）不是数字块，仍按原样一列。
- 测试：`e2e/pages-phone.spec.ts` 一例：390 px、`/customers/u-04`，四个数字落在两个不同的 x、两个不同的 y，页面无横向滚动。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`（197）、`npx vitest run`（55 文件 388 例）、`npx eslint src e2e`、`npm run build`（预算全绿）通过；Playwright 的 `pages-phone`、`node-detail`、`customers`、`today-phone` 加 `--ignore-snapshots` 共 110 例通过。
  新测试已在旧代码上跑过，失败（两个 x 位置只有一个）。手机基线 `customer-detail.png` 与 `ledger.png`（`pages-phone`）会变，本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：截图基线需在 macOS 上重录。
