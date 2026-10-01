# codex-ledger (Codex account 2 slots; mirrored from the orchestrator LEDGER.md on the box)

## Codex account-2 slot results (Sol, executor)

### W1-sol-cp (finished 19:51 MT; 60 hypotheses, 38 FP, PRs: #821 #832 #839 #865 #883 #890 #903 #918 #924 #931 #938 #947)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| SOL-CP-AUTH-GATES | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate #716 / H4-F3 | Shared-admin and legacy reads bypass role authorization [services/control-plane/src/index.ts:2928] |
| SOL-CP-CURSOR-LONG-EMAIL | C7a/C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate of #770 merged cursor bound expansion | Cursor sort key rejects valid long customer email at page boundary [services/control-plane/src/ops/http.ts:23] |
| SOL-CP-HOME-PASTE-PASSWORD | C7a/C5 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed decision item: shared credential authority/rotation semantics; automatic replacement could overwrite a newer shared secret | Pasting same home tuple with different pasted password keeps old password unless flagged [services/control-plane/src/ops/shared-admin/home-exits.ts:178] |
| SOL-CP-LOG-RENEW-SWEEP | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #947 | Expired-window sweep can delete a renewed grant [services/control-plane/src/ops/shared-admin/diagnostics-logs.ts:96] |
| SOL-CP-ONBOARD-ROLE | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed decision item: onboarding inventory rights overlap #716 policy | Operator onboarding internally edits inventory owner-gated by #716 [services/control-plane/src/ops/legacy-handlers/users.ts:267] |
| SOL-C5-RELEASE-RANGE-BUFFER | C5 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #821 | Legacy ranged installer GET buffers and copies selected body [services/control-plane/src/releases/host.ts:118] |
| SOL-CP-HY2-RETIRE-DRAIN | C7b | Sol (Codex acct 2, W1-sol-cp) | P1 | real-fixed #832 | Retirement misses recent HY2 clients and revokes exit admission before drain [services/control-plane/src/ops/retire-dependencies.ts:64] |
| SOL-CP-MONTH-RECON-SNAPSHOT | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #839 | Closed month omits frozen reconciliation snapshot [services/control-plane/src/ops/ledger.ts:80] |
| SOL-CP-DIAGNOSTICS-PARTIAL | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #918 | Invalid later array entry returns 400 after earlier diagnostic rows commit [services/control-plane/src/telemetry/diagnostics.ts:156] |
| SOL-CP-METRICS-NAME | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #890 | Valid node constructor collides with inherited object key and metrics throws [services/control-plane/src/ops-timeseries.ts:479] |
| SOL-CP-CLUSTER-LAST-SEEN | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #903 | Delayed events rewind last_seen and split active outage [services/control-plane/src/telemetry/failure-clusters.ts:237] |
| SOL-CP-SESSION-REWIND | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #924 | Retried beginning payload clears completed-session fields and bytes [services/control-plane/src/telemetry/diagnostics.ts:162] |
| SOL-CP-EXCERPT-PRIVACY | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #931 | Privacy-safe excerpt intake preserves complete IPv6 addresses and tokens [services/control-plane/src/telemetry/diagnostics.ts:151] |
| SOL-CP-CLUSTER-OPEN-RACE | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate fixed #766 | Concurrent cluster opens may collide [services/control-plane/src/telemetry/failure-clusters.ts:217] |
| SOL-CP-LEDGER-CLOSE-RACE | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #883 | Close can freeze a summary missing a ledger write accepted during reads [services/control-plane/src/ops/handlers/ledger.ts:323] |
| SOL-CP-PROFILE-PORT | C7b | Sol (Codex acct 2, W1-sol-cp) | P3 | real-unfixed decision item: persisted profile schema has no port field | Documented profile port is validated then discarded [services/control-plane/src/ops/handlers/nodes-profile.ts:107] |
| SOL-CP-REVERSE-CLOSE-RACE | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #865 | Close racing reversal leaves dangling reversed_by despite rejected INSERT [services/control-plane/src/ops/handlers/ledger.ts:273] |
| SOL-CP-ADMIN-REFRESH-DEFAULT | C9 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed deferred under requested UI restriction; runtime proved | Absent localStorage key disables default auto-refresh [services/control-plane/admin/src/hooks.tsx:213] |
| SOL-CP-ADMIN-HY2-IDENTITY | C9 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed deferred under requested UI restriction; runtime proved | Legacy console creates second machine identity for hy2 block [services/control-plane/admin/src/lib/catalog.ts:31] |
| SOL-CP-ADMIN-USERS-PAGE | C9 | Sol (Codex acct 2, W1-sol-cp) | P3 | real-unfixed deferred under requested UI restriction; scaling-only | Legacy user client ignores pagination beyond 2000 customers [services/control-plane/admin/src/api.ts:685] |
| SOL-CP-ADMIN-DRAFT-RACE | C9 | Sol (Codex acct 2, W1-sol-cp) | — | duplicate #713 removes legacy editor | Dirty editor might bypass discard confirmation [services/control-plane/admin/src/pages/ControlPage.tsx:241] |
| SOL-CP-CURSOR-UNICODE-LIMIT | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #938 | Accepted long Unicode node names exceed encoded cursor bounds or token parser cap [services/control-plane/src/ops/http.ts:22] |
