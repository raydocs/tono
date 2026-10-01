## 2026-09-26 · May macOS dial the cached catalog before Tono has verified the account?

- Status: provisional
- Chosen: no. Connect (and every protected reconnect, wake recovery and Retry through it)
  needs Tono to have accepted the session in this process (a 2xx answer, `me()` readmitting
  the account, or a sign-in) or an offline admission on a matching grant. A launch still
  restoring waits for that; a restore that fails without a grant stays in error with PF held
  until Retry succeeds. Rejected: dial the cached exit whenever no offline grant is in play
  (previous behavior).
- Why stricter: no exit is dialed for a session no server accepted and no grant admitted.
  Availability narrows only for a crash-recovery launch during restore and an unverified
  error state, both already fail-closed.
- Applied in: [#652](https://github.com/raydocs/tono/pull/652) (R612-O5).
