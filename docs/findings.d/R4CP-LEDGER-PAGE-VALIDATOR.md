| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CP-LEDGER-PAGE-VALIDATOR | Editing an existing ledger row leaves its page ETag unchanged and conditional reads return stale 304 | fixed | [#1091](https://github.com/raydocs/tono/pull/1091) | P3·已复现 | Current console does not send conditional reads; API consumers using If-None-Match are affected |

`getLedger` previously used only month, newest creation time and row count. A successful note/subject/payment edit changes none of those values. Hash the already loaded bounded page DTOs into the validator; no extra database read or wire-body change. One actual Worker/D1 edit-then-conditional-read regression failed with 304 before the fix and passes with the edited row, then verifies an unchanged read still returns 304.
