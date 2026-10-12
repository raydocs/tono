## 2026-10-10 · How the macOS client moves on its own from a node's Reality block to its ` · hy2` block (A17)
- Status: provisional (backlog A17 macOS half, D1-C, while the owner was asleep; the owner may revisit)
- Chosen: the client moves only when the signed-in device's last `GET /api/v1/exit-catalog` 200 in this launch
  carried `hy2AutoSwitch: true` (A18, [decision 079](079-2026-10-10-amp-backlog-defaults.md) D1-C). Missing,
  non-boolean or `false`, a refused catalog or a 200 whose body does not decode, or another account: Reality only, and that account's remembered
  choices and counters are cleared. The value is not cached across launches; until the first 200 of a launch
  the client does not move (the remembered choice survives on disk but is not used).
  After **3** consecutive `CORE_EXIT_UNREACHABLE` connect failures on a Reality block, the next connect attempt dials
  that node's twin: name equals the base name plus ` · hy2`, `type: hysteria2`, its password equals the Reality
  block's UUID (the same Tono identity), the bundled core can authenticate its SPKI pin, and its UDP is not known
  vendor-blocked (Tokyo). No other node is ever chosen. Other failure classes (DNS, helper, TUN) neither count nor
  reset. An automatic hy2 attempt that reaches Connected through the same readiness checks is remembered for that
  node for **24 h** (UserDefaults, owner-scoped by SHA-256, base names and dates only); connects in that window dial
  hy2 (a remembered success does not extend it), after it Reality is tried again. Starting an automatic hy2 attempt
  consumes the node's strikes and memory and blocks another automatic hy2 attempt on that node for **30 min**; only
  Connected gives the memory back, so a failed, stalled (watchdog) or cancelled hy2 attempt cannot repeat; a Reality
  success does not lift that block. Sign-out or a switch to another account drops all of it (permission, strikes,
  memory, blocks). The memory also clears when the twin leaves the
  catalog, the flag turns false, or the user picks either block of that node. The swap is in memory only: the saved
  selection stays the Reality block, and PF is armed for the dialed node exactly as for a manual hy2 pick.
  Rejected: caching the flag with the catalog for offline launches (more launches that move without a fresh grant);
  counting every failure class (a DNS or helper failure says nothing about Reality reachability); persisting the hy2
  name as the selection (it would never return to Reality); skipping the unarmed ladder's TCP proof to reach hy2
  sooner (it would arm PF without any reachability proof).
- Why stricter: nothing moves without a fresh server grant for this account, never to another node or identity, at
  most one automatic hy2 attempt per node per 30 min, no new PF permit, no helper change, and the user's own choice
  is never overwritten.
- Applied in: PR `amp/a17-hy2-auto-switch-macos` (`apps/macos/Tono/Core/Hy2AutoSwitch.swift`).
