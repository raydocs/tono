# 2026-10-05 · Decision 060: keep Connected and warn on sustained system-DNS failure / missing uplink

Docs only. Records the owner's product call (chat, 2026-10-05) for the two findings left open on #1386/#1395:
WIN-DNS-RACE-MASKS-SYSTEM and WIN-MISSING-UPLINK-GRACE. Neither takes a Windows session out of
Connected: protection and the tunnel stay up, the UI shows a DNS warning or a bounded "recovering"
sub-state. Grace length and copy are not decided; no code changes.

- Source: `docs/decisions/060-2026-10-05-keep-connected-warn-on-dns-and-uplink.md` (status `provisional`).
- Gate: none (0.0.75 cycle input; outside the 0.0.74 G4 freeze scope).
- Verification: not run (docs only).
- Package: source only, no new candidate.
