## 2026-10-05 · Does a persistent system-DNS failure or a missing uplink take a Windows session out of Connected?

- Status: provisional (the owner chose this option in chat on 2026-10-05, replying to the
  agent's recommendation; the owner can set `owner` here)
- Chosen: no. Both keep the session, the Core and the armed WFP barrier, and show the user
  what is wrong. The two findings this answers, both recorded on #1386 and left open on #1395:
  - WIN-DNS-RACE-MASKS-SYSTEM: a connect whose system DNS keeps failing while the TUN
    listener answers stays Connected, and the App shows a DNS warning fed by the Service's
    system-query advisory. Rejected: failing the connect, or releasing, on a sustained
    system-DNS failure. That would reverse the owner quick fix in SHIP_PLAN §1 (TUN
    fake-ip answer admits the connect when system DNS times out) and G1.1 (Win10 must pass
    `securingDNS`).
  - WIN-MISSING-UPLINK-GRACE: after sleep or a Wi-Fi flap, a session whose physical
    uplink is briefly gone is held in a bounded "recovering" state, not torn down and not
    selectively released after two failed event probes. Rejected: rebuilding or releasing
    at once. The DIRECT binding losing its route stays the decision 037 exception.
- Why stricter: neither branch widens a release path. Protection stays armed and the
  tunnel stays up in both cases; the change is what the UI claims (a warning, or
  "recovering" instead of "connected") and when the existing decision 030/031 handling
  runs (only after the bounded grace, never on the first missed probe). The verifier's note
  on the DNS finding, that telemetry and a warning alone are not enough, is a product call
  the owner made the other way: a warned, protected, partially working session beats a
  release for a mainland customer whose system resolver is the thing that is broken.
- Not decided here: the grace length for the missing-uplink state and the exact UI copy;
  both need the sleep/Wi-Fi device round. Until then nothing changes in code.
- Applied in: the 0.0.75 cycle, after the 0.0.74 freeze. Windows App: read the Service
  system-DNS advisory into the health legs and surface it; add the "recovering" connection
  sub-state (keeps Core/WFP, not counted as Connected). Findings fragments:
  `docs/findings.d/WIN-DNS-RACE-MASKS-SYSTEM.md`, `docs/findings.d/WIN-MISSING-UPLINK-GRACE.md`
  (both on #1386/#1395, to be pointed at this file when those merge).
