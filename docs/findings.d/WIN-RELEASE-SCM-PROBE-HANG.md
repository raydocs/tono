| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RELEASE-SCM-PROBE-HANG | An unresponsive read-only SCM query retains Disconnect's release worker indefinitely; Connect/Repair also make unbounded evidence/BFE reads | in-PR | [#912](https://github.com/raydocs/tono/pull/912) | 中·已确认（P1） | Failed-before/passed-after portable tests; full Windows/Tauri CI and real SCM fault validation required |

Baseline `d628cef8`: `core/service/mod.rs:524` awaits the stopped-state probe without a deadline. Its production closure at `:479` runs `registered_service_stopped` on a blocking thread, so one stalled SCM RPC remains awaited forever after the initial bounded readiness failure. `tono/connection/disconnect.rs:216-224` retains the exclusive release guard; `:164-167` waits for that worker, while the 55-second UI wait at `:91` deliberately leaves reconciliation running. Subsequent Disconnect/sign-out therefore cannot finish. This is an operation hang, not a proven machine freeze or a P0 outage.

The same read-only defect exists at `core/service/mod.rs:614` (`trusted_service_evidence` inside async repair) and `tono/connection/controller.rs:120` (synchronous BFE error diagnosis). The latter prevents its task reaching cancellation checks at all. BFE preflight also awaited an unbounded blocking query.

Fix: five-second stopped-state deadline; read-only registration/BFE calls dispatched through a bounded blocking helper. Timeout cannot start or repair a service. Registration remains unproven; BFE remains nonfatal only where existing unknown-BFE behavior already permits authoritative Service diagnosis. No WFP, DNS, routes, strict-mode or AI-blocking policy mutation changes.

Regressions: `the_release_path_bounds_a_stalled_service_state_probe` fails before because no result arrives and proves neither start nor repair is attempted; `a_stalled_read_only_service_probe_returns_without_waiting_for_its_thread` fails before and proves async completion while the read-only thread is still stalled. Linux exact-source harness passes those plus the existing readiness-choice regression (3 passed). Native OS fault injection not performed.
