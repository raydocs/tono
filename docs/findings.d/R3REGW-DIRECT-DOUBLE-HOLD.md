| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3REGW-DIRECT-DOUBLE-HOLD | Committed DIRECT expiry redundantly removes and reinstalls the secondary AI hold after general traffic has opened | fixed(0f7473f4) | [#1044](https://github.com/raydocs/tono/pull/1044) | 低·已确认（P2，Linux 回归） | Transient native firewall/NRPT exposure; Windows hardware acceptance remains. Existing best-effort AI coverage limitations are unchanged. |

Tonight's recovery helper now installs the hold itself. Its DIRECT expiry caller must not apply the same hold again. Strict and in-flight ownership retraction keep their existing admission and protection.
