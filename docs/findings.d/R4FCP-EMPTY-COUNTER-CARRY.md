| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-EMPTY-COUNTER-CARRY | Lost-ledger recovery with no counter labels absorbs later new usage | fixed | [#1199](https://github.com/raydocs/tono/issues/1199); [#1206](https://github.com/raydocs/tono/pull/1206) | 中·已确认（P2） | Missing ledger and initially absent counters; live Xray acceptance not run |

`adopt_source_watermarks` skipped a known source watermark when the account had no retained counter labels. A successful empty observation saved no history; the next device generation's80 bytes were absorbed into the old1050 watermark. The real two-round `run_once` regression fails on fresh main `6082fdee`. An accounting-only `u:<userId>` carry now retains1050, so the next80 reports1130. It never enters roster or installed-client authorization. This is separate from the legacy handoff and unobservable reset-generation decisions in issues #4/#5.
