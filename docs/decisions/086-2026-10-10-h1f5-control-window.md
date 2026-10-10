## 2026-10-10 · H1-F5 bootstrap window (A30, D4-A): how long the control-plane permit may exist, and on which platform
- Status: provisional
- Chosen: macOS moves the Tono API host's PF permit (`tono-control`, the API host's pinned addresses, TCP 443, root and
  the interactive user; rule text unchanged) into the child anchor `tono.killswitch/control`, which the parent ruleset
  references where the permit used to sit, only without a tunnel. The child is loaded only inside a control window: the
  app takes a lease right before each path attempt (system resolver, pinned; the relays are not in the permit) and
  returns it as soon as the attempt answers, fails or is cancelled. The helper withdraws the permit 15 s after the window
  opened (N = 15) whatever its leases; joining never extends a window, and a permit left by an expired window is
  withdrawn before a new window loads. Sleep and release close every window, and a helper start flushes the child.
  Withdrawal is `pfctl -a tono.killswitch/control -F rules` plus a kill of the API addresses' states: no file write, no
  effect on the parent ruleset; a failed withdrawal is retried (1 s, then 2 s) and logged, and never escalates to the
  emergency block or a release. The Windows Service is not changed: its bootstrap API channel already matches only the
  installed Tono app's AppId (#334), so no non-Tono process can use it at any time, and a timer there would need a new
  Service IPC revision without narrowing the H1-F5 exposure. Rejected: a helper proxy for control-plane requests (D4-B,
  rejected in decision 079); a window that each new attempt extends (it could stay open under steady traffic); one lease
  for a whole multi-path exchange (a slow first path would leave the pinned fallback on an expiring window); rewriting
  the parent ruleset to withdraw (a failing file write would keep the permit); a Windows timer in this PR.
- Why stricter: the macOS permit used to exist for as long as protection was armed without a tunnel (bootstrap,
  Protected Offline; the connected arm already dropped it). It now exists only inside a path attempt, for at most 15 s
  per window, with the same addresses, port, protocol and UIDs as before; nothing is added to the ruleset. Every failure
  path (attempt error, lost lease, expired window, helper restart, failed load) ends with the child flushed or a retry,
  and none of them can loosen the parent's block. Windows keeps the binding that already excludes every other process.
- Applied in: PR #1507 (`amp/a30-bootstrap-window`, A30), helper 4.52.45; H1-F5 recorded as 已知风险，窗口 ≤ 15 s.
