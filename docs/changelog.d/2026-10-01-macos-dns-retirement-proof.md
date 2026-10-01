## 2026-10-01 · Keep ownership proof through repeated DNS cleanup
- Ownership: SHIP_PLAN §2 item 10; macOS helper Disconnect recovery.
- Source: baseline `64e8b593`; branch `hunt/sol-r4fma-dns-retirement-proof`, not merged at authoring.
- Bug fix: #1097. A normal Disconnect's first owner restore retains completion evidence before deleting/archiving its snapshot; its second cleanup preserves another service's loopback resolver, including across helper restart. New managed writes/snapshots invalidate old evidence before effects, and corruption invalidates evidence while retaining snapshotless recovery.
- Added/optimized: no new DNS servers, suffixes, PF, AI disposition, or strict-mode behavior.
- Engineering/test: one root lifecycle regression uses an actual temporary durable receipt and two production restore transactions; it verifies owner originals and foreign loopback survive, then clears evidence and proves independent snapshotless sweep still runs.
- Verification: Linux `git diff --check`, findings parser and exact helper contract. Native Swift execution unavailable; macOS CI required.
- Candidate/publication: source only, no new package or publication.
- Remaining limits: `needs-hardware`; failed receipt persistence plus helper restart; superseded re-enable plus failed new snapshot save needs a separate fault-path proof.
