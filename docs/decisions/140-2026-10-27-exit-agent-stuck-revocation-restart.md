## 2026-10-27 · Should the exit agent restart Xray when a revocation keeps failing?

- Status: provisional (agent, 2026-10-27; owner asked for an isolated, default-off evaluation only)
- Chosen: an opt-in restart, **off by default** (`TONO_RESTART_XRAY_ON_STUCK_REVOCATION=1`). Alert-only
  stays the production behaviour until the restart has run on a real node and the owner decides to enable it.
  When enabled, the agent restarts `tono-xray` only when all of these hold:
  1. A `u:` client's removal failed in 3 consecutive reporting rounds (add failures and `shared-legacy` never count).
  2. The round reached the control plane and delivered its usage.
  3. A counter read right before the restart succeeded, with a readable start marker, and was folded into the totals.
  4. No attempt (failed or successful) in the last hour of roster time; the attempt is saved before `systemctl` runs.
  After the restart the agent reinstalls the roster and checks the revoked label is gone. It never acknowledges
  in that round.
- Rejected:
  - (a) Restart on the first failed removal: one transient API error would drop every connection on the node.
  - (b) No restart ever: a revoked, expired or over-quota account keeps access until an operator acts
    (today: `node-roster-stale` after 15 min, then the node leaves the catalogs).
- Tradeoff: a restart costs every customer on the node a few seconds of reconnection; leaving it off costs one
  revoked account continued access until an operator restarts Xray. Usage is not lost either way (folded before
  the restart; the next round folds the new process's counters as a restart).
- Not verified: a real Xray node; whether the agent's unit may restart `tono-xray` (unit files are not in the repo).
- Applied in: `services/exit-agent/reconcile_and_report.py` (`restart_for_stuck_revocation`), branch
  `feat/exit-agent-stuck-revocation-restart`.
