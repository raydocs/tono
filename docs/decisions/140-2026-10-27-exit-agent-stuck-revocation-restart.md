## 2026-10-27 · Should the exit agent restart Xray when a revocation keeps failing?

- Status: provisional (agent, 2026-10-27; owner asked for an isolated, default-off evaluation only)
- Chosen: an opt-in restart, **off by default** (`TONO_RESTART_XRAY_ON_STUCK_REVOCATION=1`). Alert-only
  stays the production behaviour until the restart has run on a real node and the owner decides to enable it.
  When enabled, the agent restarts `tono-xray` only when all of these hold:
  1. A `u:` client's removal failed in 3 consecutive reporting rounds (add failures and `shared-legacy` never count).
  2. The round reached the control plane and delivered its usage.
  3. A counter read right before the restart succeeded, with a readable start marker, and was folded into the totals.
  4. No attempt (failed or successful) in the last hour of roster time; the attempt is saved before `systemctl` runs.
  5. Fewer than 2 attempts since the last converged round. A cause a restart does not fix (wrong inbound tag,
     broken API) stops after the second attempt instead of dropping the node every hour; an operator fixes it and
     the next converged round restores the budget.
  After the restart the agent starts restore attempts for up to 30 s (every 2 s; an attempt already running can still take its own RPC timeouts, 30 s each, and a timed-out add skips the remaining adds) for the new process and reinstalls the roster and checks the revoked label is gone. It never acknowledges
  in that round.
- Rejected:
  - (a) Restart on the first failed removal: one transient API error would drop every connection on the node.
  - (b) No restart ever: a revoked, expired or over-quota account keeps access until an operator acts
    (today: `node-roster-stale` after 15 min, then the node leaves the catalogs).
- Tradeoff: a restart costs every customer on the node a few seconds of reconnection; leaving it off costs one
  revoked account continued access until an operator restarts Xray. Usage is not lost either way (folded before
  the restart; the next round folds the new process's counters as a restart).
- Customer outage per restart: Xray's own restart time, plus the time until the API answers. If it answers within
  about 30 s the roster is reinstalled in the same run; otherwise every API-added client stays offline until the next
  timer round (about 60 s after the run ends, so at worst about 30 s + 60 s + one round). Real-node timing unknown.
- Usage not billed: traffic between the pre-restart counter read and Xray stopping (one state save plus systemd's
  stop) is lost with the old counters. It is never double-billed and always in the customer's favour; bound =
  node throughput × that window (for example about 12 MB at 100 Mbit/s for 1 s), once per restart, at most twice
  before a converged round.
- Rounds that refuse before reporting (outage, corrupt state, clock ahead) neither count nor reset the 3-round
  streak; this only delays a restart.
- Not verified: a real Xray node; whether the agent's unit may restart `tono-xray` (unit files are not in the repo).
- Applied in: `services/exit-agent/reconcile_and_report.py` (`restart_for_stuck_revocation`), branch
  `feat/exit-agent-stuck-revocation-restart`.
