| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4SW-MAC-RETRY-BACKOFF | macOS TCP 可达但 TLS/流量失败的自动恢复每次都重置两秒重试，反复安装和释放保护 | fixed(42389cb9) | #1086 | 中·已确认 | P1; native XCTest / needs-hardware pending |

Every new unarmed owner began its local attempt counter at zero. A successful TCP proof terminated that owner, while a subsequent failed connection released and created another owner at the first two-second rung. TCP acceptance is not a verified session. Carry the next backoff rung across automatic connection admission/failure, preserve it through automatic cleanup, and reset only on verified connection success or fresh Connect intent. The no-argument Connect API remains intact. One regression drives two automatic admissions through the real AppState loop, safely refuses runtime work at the boot-record seam, and requires delays `[2, 5]` rather than `[2, 2]`.
