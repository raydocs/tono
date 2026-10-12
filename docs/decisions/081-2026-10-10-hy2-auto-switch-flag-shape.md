## 2026-10-10 · hy2 auto-switch flag: how "internal account" is marked, which switch wins, and where clients read it
- Status: provisional
- Chosen: D1-C ([079](079-2026-10-10-amp-backlog-defaults.md)) is implemented as an ops-set `users.internal_account`
  boolean (default false; no account is guessed internal by email domain or gray list), a per-account override
  `on | off | null`, and one global "all accounts" switch (default off, flipped only by an operator; no timer).
  Order: per-account `off` beats everything, per-account `on` beats the defaults, otherwise global or internal.
  Clients read the resolved boolean `hy2AutoSwitch` from their own authenticated `GET /api/v1/exit-catalog`
  response, and it is `false` whenever that response stripped the hy2 blocks. Rejected: inferring internal from
  `HY2_CATALOG_EMAILS` or an email domain; letting the global switch override a per-account off; carrying the flag
  in the signed traffic policy (one global document, signed offline, cannot be per-account without changing the
  signature path); folding it into `routingSha256` (released Windows builds verify that digest with a fixed recipe).
- Why stricter: every account resolves off until an operator acts; a per-account off can always hold one account
  back after the global flip; the flag only permits moving to the ` · hy2` block of the node already selected and
  never changes catalog membership, the traffic policy or its signature.
- Applied in: PR `amp/a18-hy2-auto-switch-flag` (migration 0100).
