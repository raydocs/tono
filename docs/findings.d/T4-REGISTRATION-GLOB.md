| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T4-REGISTRATION-GLOB | test-suite-reachability.sh did not recognize wildcard invocations, and two suites plus the guard itself had no caller | in-PR | [#1059](https://github.com/raydocs/tono/issues/1059) | 低·已确认 (P3) | Wildcard in the file name only (a wildcard in a directory part is ignored); the guard now runs in services-ci; a suite named by a non-sequence line still counts as wired even if that line does not execute it |
