| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SCM-VERIFIER-WORKERS | Recurring status polls keep spawning detached SCM verification threads during one prolonged SCM stall | in-PR | [#933](https://github.com/raydocs/tono/pull/933) | 中·已确认（P2） | Narrow failing-then-passing Linux regression; actual Windows SCM stall and resource exhaustion not reproduced |

Baseline `560af1ac`, `service/src/client/mod.rs:165-174`: `run_with_deadline` starts an OS thread, returns after three seconds in the verifier, and leaves stalled SCM work detached. The sixteen-worker IPC runtime and vendor eight-connect budget cover the outer request, not the surviving inner thread. Request retry counts therefore do not cap process-lifetime thread growth.

The App's owner monitor (`core/service/owner.rs:34-54`) continues polling if the Core's HTTP endpoint answers. Connected monitoring (`tono/connection/monitor.rs:778-817`) likewise preserves a proven data plane, and Protected Offline resync (`:600-633`) continues every thirty seconds without a usable Service reading. One prolonged SCM stall can therefore accumulate workers. Severity stays P2: no actual machine exhaustion is claimed.

Fix: eight process-wide OS worker slots, matching the transport's concurrent blocking-connect budget. Each detached thread owns its slot until work completes. Full capacity returns the existing unproven result; no identity or strict/protection checks are bypassed. Spawn failure/panic/completion drops the owned slot.

Regression `timed_out_os_work_retains_its_slot_until_the_thread_finishes` holds one OS call after its caller times out, proves another call cannot start, then releases it and proves capacity returns. Before: the second call ran and returned `Some(9)`; after: the client retry-safety suite passes 10 tests. Native Windows verification remains for CI/hardware.
