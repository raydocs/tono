# 月结与账目模型（提案，待拍板）

这是 GPT 评审"四张单"里最后一张——月结——的数据模型提案。它不是代码，先请你拍板口径，再进入迁移与页面。**这里所有金额都只做登记与对账，不接支付平台。**

## 1. 要回答的四个问题

1. 这个月实际收了多少钱、退了多少、补偿了多少？
2. 这个月服务器、家宽、域名、控制面各花了多少？年付的机器这个月摊多少？
3. 商家账单和我们的计量对不对得上？差在哪台机器？
4. 每个客户、每台机器的毛利是多少——**在用量缺测时要显示"待核对"，不能算出漂亮的数字。**

## 2. 数据模型（迁移 0052 起，只增不改）

| 表 | 一行是什么 | 关键列 |
|---|---|---|
| `ops_ledger_entries` | 一笔收入或支出 | `id`, `kind` (`revenue`/`refund`/`credit`/`cost`), `category` (`plan`/`server`/`home_line`/`domain`/`control_plane`/`other`), `subject_type` (`user`/`node`/`home_exit`/`account`/`fleet`), `subject_id`, `amount_minor` (整数，最小货币单位), `currency`, `fx_rate_to_cny` + `fx_date`, `period_start`, `period_end`（服务周期）, `paid_at`, `provider_account_id?`, `note`, `evidence_url?`, `created_by`, `created_at` |
| `ops_month_close` | 一个月的锁定 | `month` (`YYYY-MM`), `closed_at`, `closed_by`, `revenue_minor`, `cost_minor`, `unreconciled_count`, `notes`；锁定后该月的 ledger 只能追加冲正行，不能改 |
| `ops_reconciliations` | 一台机器一个周期的对账 | `node`, `cycle_start`, `cycle_end`, `provider_bytes?`（商家面板抄来的）, `metered_bytes`（我们的 `node_traffic_cycles`）, `diff_pct`, `status` (`ok`/`diff`/`missing`), `resolved_note` |

规则：
- **年付按月摊**：`cost` 行的 `period_start/end` 跨多月时，月结按天数比例摊入各月；现金流另有 `paid_at`，两者都显示，不混。
- **币种**：原币入账，`fx_rate_to_cny` 在入账当天取；月结用入账汇率，不回溯。
- **客户收入归期**：套餐费按服务周期摊，不按收款日；退款/补偿计入发生月。
- **毛利**：`客户毛利 = 该客户当期收入 − 分摊成本`；分摊成本 = 该客户在各机器上的字节占比 × 机器当期成本。**任一机器当期计量 `status ≠ ok` 时，涉及它的客户毛利显示"待核对"。**

## 3. 接口

`GET/POST ledger?month=`、`PATCH ledger/{id}`（未锁定月）、`POST ledger/{id}/reverse`（冲正）；`GET month-close?month=` → 汇总 + 未对账清单；`POST month-close {month}`（锁定，需确认）；`GET reconciliations?cycle=`、`PATCH reconciliations/{id} {providerBytes, note}`；`GET export/month.csv?month=`。

## 4. 页面

设置 → **账目**：本月一页（收入/支出/差异三块 + 待核对清单 + "锁定本月"），录入抽屉（收入/支出各一，套餐续费从客户页的"改到期"顺手写一笔），对账表（每台机器一行：商家字节 vs 计量字节 vs 差异）。客户 360 的"账务与用量"加"本期收入 / 分摊成本 / 毛利（或待核对）"三个事实。节点详情"本周期流量"下加"每 GB 成本"。

## 5. 已拍板（2026-09-10）

1. **收入按月归期**：所有套餐都是月付，一笔收入记在它对应的月份，不做跨月分摊。
2. **汇率实时取**：Worker 每天从 frankfurter（欧洲央行数据，免密钥）拉一次 USD→CNY 等汇率并落表；入账时按入账日汇率换算，记录汇率与来源，不回溯。
3. **商家账单指 Claude / ChatGPT 账号**：成本按账号逐条记（`claude_account` / `chatgpt_account`），归到持有它的客户；服务器、家宽、域名、控制面各自成类。字节对账保留但不是主要路径。

## 6. 冻结的接口形状（Worker 与控制台同时按这个做）

- `LedgerEntryDto { id, kind: revenue|refund|credit|cost, category: plan|server|home_line|domain|control_plane|claude_account|chatgpt_account|other, subjectType: user|node|home_exit|account|fleet, subjectId, amountMinor, currency, fxRateToCny, fxDate, cnyMinor, month: 'YYYY-MM', paidAt, note, reverses, reversedBy, createdBy, createdAt }`
- `MonthSummaryDto { month, closedAt, closedBy, revenueCnyMinor, costCnyMinor, marginCnyMinor, byCategory: Record<category, cnyMinor>, customers: [{ userId, email, revenueCnyMinor, costCnyMinor, marginCnyMinor|null, pending: boolean }], nodes: [{ name, costCnyMinor, bytes, cnyPerGb|null, pending: boolean }], unreconciled: number, updatedAt }`
- `FxRateDto { day: 'YYYY-MM-DD', base, quote: 'CNY', rate, fetchedAt, source: 'frankfurter' }`
- 路由：`GET ledger?month=`、`POST ledger`、`PATCH ledger/{id}`（未锁定月）、`POST ledger/{id}/reverse`、`GET months/{month}`、`POST months/{month}/close`、`GET months/{month}/export.csv`、`GET fx?day=&base=`。

## 原 5. 需要你决定的三件事（已决定，留作记录）

1. **口径**：客户收入按服务周期摊（提案）还是按收款月？
2. **汇率**：入账日汇率（提案）还是月末统一汇率？
3. **手工录入的边界**：商家账单只抄总额（提案）还是逐项？逐项更准但你每月要多花时间。

拍板后我出 brief：Worker（迁移 0052 + 接口）给 Grok，页面给 Opus，我审。
