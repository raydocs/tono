| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-QUOTA-ROUNDTRIP | Saving a node profile rounds a fractional GB quota even when only another field changed | in-PR | [#825](https://github.com/raydocs/tono/pull/825) | 低·已确认 | P2; operator-visible field correction requires ui-review; no auto-merge |

`ProfileDrawer.formOf` displays `bytesToGb(node.quota.value.quota)` and `bodyOf` submits the whole form using `gbToBytes`. Rounding the display to a whole GB changes valid stored quotas on every save. Preserve the fractional GB value instead. The regression round-trips 1,500,000,001 bytes.
