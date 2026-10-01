| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-JOURNAL-BANNER | Restart verification mistakes journalctl's empty-result banner for an error and accepts a failed journal read | in-PR | hunt/sol-r3ops-journal-verification | 低·已确认（P2，Linux 回归） | Fixture-only verification; no real VPS/systemd operation. Healthy apply was unnecessarily rolled back; no customer-wide outage claimed. |

The guard now requests quiet output, checks the journal query exit status, then rejects actual error entries. The real verifier runs against a fixture transaction in three narrow regressions.
