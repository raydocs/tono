## 2026-09-30 · Retire restored Windows adapter snapshots
- Ownership: SHIP_PLAN §2 item 10; round-four DNS/PF/WFP restore regression review.
- Source: main `7f382af7`; branch `hunt/sol-r4dns-retired-snapshot`; source PR, awaiting CI/merge.
- Defect fix: after a proven restore leaves a locked snapshot behind, an offline DNS change was overwritten by the previous session's originals. Digest-bound retirement evidence prevents repeated adapter restore and lets the next session capture current originals. Finding WIN-DNS-RETIRED-SNAPSHOT-REPLAY, P2.
- New features: none; NRPT/DoH cleanup and Tono-resolver safety checks remain required; strict WFP and AI blocking behavior unchanged.
- Engineering/tests: narrow regressions cover next-session recapture, restore without repeating the old DHCP reset, and stale-record refusal for a new unproven restore.
- Verification: Linux Rust, CARGO_BUILD_JOBS=2; baseline recapture regression failed with old `10.0.0.53` instead of new `192.168.1.53`; final DNS/WFP checks recorded in the PR. Windows-only native engine and installed-device testing unavailable here.
- Candidate/publication: source only; no new candidate, deployment or publication.
- Remaining limits: deletion plus retirement-persistence failure leaves a surfaced replay risk; native Windows AV-lock, restart and adapter-change scenarios require hardware acceptance.
