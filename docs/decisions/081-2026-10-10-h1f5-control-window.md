## 2026-10-10 · H1-F5 bootstrap window (A30, D4-A): how long the control-plane permit may exist, and on which platform
- Status: provisional
- Chosen: macOS bounds the Tono API host's PF permit (`tono-control`, the API host's pinned addresses, TCP 443,
  root and the interactive user) to a control window. The app opens it right before a control-plane exchange and
  returns it as soon as the exchange answers, fails or is cancelled. The helper closes it on its own 15 s after it
  opened (N = 15), joining exchanges never extend it, sleep closes it, and it never renders beside a tunnel. Closing kills
  the API addresses' PF states, so no flow opened inside the window outlives it. A withdrawal that fails is retried every
  second; the third failure in a row loads the emergency all-block. The Windows Service is not changed: its bootstrap API
  channel already matches only the installed Tono app's AppId (#334), so no non-Tono process can use it at any time,
  and a timer there would need a new Service IPC revision without narrowing the H1-F5 exposure. Rejected: a helper
  proxy for control-plane requests (D4-B, rejected in decision 079); a window that each new exchange extends (it could
  stay open indefinitely under steady traffic); a Windows timer in this PR.
- Why stricter: the macOS permit used to exist for as long as protection was armed without a tunnel (bootstrap,
  Protected Offline; the connected arm already dropped it). It now exists only
  inside an exchange, for at most 15 s, with the same addresses, port, protocol and UIDs as before; nothing is added to
  the ruleset. Every failure path (exchange error, lost lease, helper restart, failed load) ends with the permit
  withdrawn or the emergency block. Windows keeps the binding that already excludes every other process.
- Applied in: PR #1507 (`amp/a30-bootstrap-window`, A30), helper 4.52.45; H1-F5 recorded as 已知风险，窗口 ≤ 15 s.
