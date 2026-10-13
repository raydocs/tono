| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T4-AGGREGATE-HIDDEN-SKIP | test-macos-all.sh discarded a passing suite's log, so the peer-authorization SKIP counted as a pass | in-PR | [#1059](https://github.com/raydocs/tono/issues/1059) | 低·已确认 (P3) | A line starting with SKIP in a suite that exits 0 is now reported as skipped; a partial skip printed any other way (for example the ci-mode ::warning) is not detected; the underlying skip stays (#956) |
