| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-LEDGER-REVERSE-AMOUNT | 同一币种的账本冲销在 CSV 原币合计里被加了第二次 | in-PR | [#767](https://github.com/raydocs/tono/pull/767) | 低·已确认 | 单行 amountMinor 仍是非负金额；月结人民币合计本来就是对的 |

`amount_minor` 有 `CHECK(amount_minor >= 0)`。冲销只把 `cny_minor` 取反。`ledgerCsv` 对两种金额都套种类符号，原币合计因此没有抵消。
