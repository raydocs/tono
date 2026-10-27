## 2026-10-27 · Does an exit-agent round that refuses after reading Xray's counters keep or report them?

- Status: owner (2026-10-27, relayed by thread T-01a17c78: option A, "部分客户端配置失败时，优先保障其他客户体验，继续上报实际测得的流量，不因为配置失败本身额外收费")
- Chosen:
  1. A refusal after the counter read (failed roster ACK, a saved roster that could not be replaced, a
     queued report or report clock outside the roster window, an unprovable inventory) folds the
     reading into the durable lifetime totals and reports nothing. This is what the outage,
     disabled-node and hy2-failure paths already did.
  2. When only some client adds or removals fail (`PartialReconcile`), the counters are read anyway
     and usage is reported as in a complete round. Neither the roster ACK nor the metering ACK is sent,
     and the round still exits non-zero.
- Rejected:
  - (a) The old rule: such rounds discard the reading. An Xray restart before the next completed round
    resets the counters, and that growth is never billed (reproduced: 4,000 of 5,200 bytes lost).
  - (b) Fold only, with no report, on a partial reconcile. Billing would stay intact, but one client the
    Xray API refuses would keep usage, and so quota enforcement, stopped for every account on the node
    until an operator fixes it.
- Why stricter: nothing is billed twice. The reports are cumulative per source, the reported totals
  (`userTotals`) and the queue are unchanged by a fold, and the next report covers the growth once.
  Quota keeps being enforced. No readiness signal is widened: a node whose roster did not converge is
  never acknowledged, so the control plane still sees it as not converged. A ledger file that is still
  missing is not created early, so watermark adoption is unchanged.
- Owner chose 2 (option A) over (b). Guarantees that go with it: neither ACK on a partial round,
  so a refused revocation is never reported as done; the label stays in the durable inventory and
  the removal is retried every round (60 s timer); only measured counters are reported, with no
  charge for the failure itself; a node whose roster ACK is 15 min old is dropped from catalogs and
  now opens a `node-roster-stale` incident (`src/ops/exit-roster-alerts.ts`).
- Applied in: `services/exit-agent/reconcile_and_report.py` (`refuse_keeping_usage`,
  `PartialReconcile`), PR for branch `fix/exit-agent-metering-durability`.
