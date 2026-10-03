| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| T4-REACHABILITY-SIGPIPE | Suite registration check rejects real references when grep -q closes a large input pipe | fixed(b6c712f0) | [#823](https://github.com/raydocs/tono/pull/823) | 低·已确认 | P3 engineering finding recorded for this hunt; no customer runtime defect; other registration gaps remain |

With `pipefail`, an early successful grep match can make the upstream `printf` fail. Consume the full input before returning the grep result. A regression uses a large workflow fixture and still requires a missing registration to fail.
