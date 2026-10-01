## 2026-10-01 · Exit agent revokes from its durable inventory when the client listing times out
- Ownership: SHIP_PLAN §2 item 9; exit-agent revocation.
- Source: baseline `0676435b`; branch `hunt/claude-be-xa-listing-timeout`. Source only.
- Defect fix: a timed-out or unstartable `xray api inbounduser` call escaped `installed_clients` and ended the round before any removal, including the disabled-node withdrawal (CBS-XA-01). It now counts as an unknown listing, so removal uses the recorded inventory as for any other failed listing.
- Added/optimized: none. ACK, metering and empty-inventory rules are unchanged.
- Engineering/tests: one `StableXrayRead` unittest; it fails on `0676435b` with an uncaught `TimeoutExpired` and passes with the fix.
- Verification: macOS Python 3, `python3 -m unittest test_reconcile_and_report`: 117 passed.
- Candidate/publication: no deploy, publication or new candidate.
- Remaining limits: live Xray/systemd acceptance not run.
