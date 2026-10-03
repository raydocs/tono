| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-FX-PREVIEW-DATE | Foreign-currency preview uses payment-day FX while the ledger records current UTC posting-day FX | fixed(03b5a8ea) | [#848](https://github.com/raydocs/tono/pull/848) | 低·已确认 | P2; ui-review, no auto-merge; browser regression awaits CI |

A backdated payment passed its paid date to `useRate`, but the create payload omits `fxDate`, so the Worker selects the current UTC day. The approved billing model uses posting-day FX. Preview and missing-rate messages now use that day; the payment timestamp remains the receipt date. The local fixture's create route now follows the Worker too.
