| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-REVERSE-CLOSE-RACE | Month close racing a ledger reversal rejects its INSERT but permanently stamps reversed_by to the missing reversal | fixed(25d525f3) | hunt/sol-cp-reversal-close-guard | 低·已确认 (P2) | Concurrent close/reverse window; existing corrupted rows are not repaired automatically. |

The reversal batch's INSERT checks the current month is open; its subsequent UPDATE had no dependency on that INSERT. The batch could commit zero inserts and one update before returning MONTH_CLOSED. The original then rejects every future reversal. Guard the UPDATE with the immediately preceding INSERT's changes() result.
