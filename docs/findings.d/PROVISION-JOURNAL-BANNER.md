| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-JOURNAL-BANNER | Restart verification mistakes journalctl's empty-result banner for an error and accepts a failed journal read | fixed(72a9c98db24f5b3f5ad30a1be7191ce17a0df0be) | [#996](https://github.com/raydocs/tono/pull/996) | 低·已确认（P2，Linux 回归） | Fixture-only verification; no real VPS/systemd operation. Healthy apply was unnecessarily rolled back; no customer-wide outage claimed. |

The guard now requests quiet output, checks the journal query exit status, then rejects actual error entries. The real verifier runs against a fixture transaction in three narrow regressions.

Merged source passed required CI; needs-hardware remains for separately authorized real exit-node restart/rollback acceptance. No real-host operation was performed by this hunt.
