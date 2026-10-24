| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-TELEMETRY-429-OUTBOX | telemetry drain 将限流 429 当作不可重试并删除待发报告，未遵守 Retry-After | in-PR | fix/t4-macos（T6 协作） | 中·已确认（P2，XCTest RED） | 待服务端联调；队列仍有原有 32 条上限，周期 window 不属于此 outbox |

证据：`apps/macos/Tono/Services/Account/AccountSession+Telemetry.swift:332-350,694-776`；
`Services/ControlPlanePath.swift:8-22,134-136,765-805,829-845`；`Services/TonoAPIClient.swift:1248-1252`。
RED `619cd5326`，队列 `0 != 1`；GREEN 与边界见 [T4 记录](../reports/T4_MACOS_2026-10-24.md)。
