# Tono 0.0.72 stability work — in progress

The owner requested stable macOS and Windows candidates both named **0.0.72**.
This is not a claim of zero defects, completed architecture migration, signed
installer acceptance, publication, or an updated customer feed.

## Handoff checkpoint (2026-09-07 23:49 America/Denver)

- Continue the existing isolated branch `feat/handoff-gpt-astra-docshandoff-architecture-up`
  at `de0328d125d704a1b2fc39949f81943bf493b9b0`, not the original dirty `main`.
- All 98 incoming changed files were archived and SHA-256 verified under the
  common Git directory: `tono-upgrade-backups/stability-0072-20260907-234948/`.
  The backup includes the index, staged/unstaged/HEAD binary patches, source
  archive, deletion records and manifest. The index was verified unchanged.
- Existing Grok work is retained. No new Worker/Linux extraction, history
  mutation, commit, push, privileged installation or network reconfiguration.
- Helper **3.15.0** and Service protocol **2.6.7** are independent compatibility
  versions; they must not be relabeled 0.0.72 to match product marketing.

## First stabilization slice

1. **Cross-platform policy contract regression.** The Worker move left the
   signing-contract test reading `index.ts` for `protectedSuffixes`, although
   production now owns it in `traffic-policy.ts`. The complete Mac umbrella
   suite reproduced the failure. The check now reads the real declaration and
   verifies that source exists; the key, signing context and protected set are
   unchanged. A temporary mutated fixture with `anthropic.com` removed is
   rejected even with a complete decoy declaration in `index.ts`.
2. **Deferred connection ownership.** `connect()` during teardown formerly
   created an untracked task. The coordinator now owns and replaces that intent;
   a newer generation or disconnect cancels it, and a late continuation checks
   both identity and generation before calling back into AppState.
3. **Serialized disconnect ownership.** The coordinator, not AppState, writes
   the disconnect task queue and request IDs. It drains cancelled in-flight
   mutations before stop/DNS/PF work. Earlier teardown still finishes privileged
   work but cannot overwrite the latest request's final UI state. This is a
   bounded behavioral correction, not a claim that all connect bodies moved.
4. **Real locale compatibility evidence.** Replace the misleading cache-key
   string test with storage reads/writes: legacy English, new-key precedence,
   retired-locale fallback, write failure retaining the legacy key, denied
   storage, and actual en/zh section loading through the restricted glob.
5. **Source version gate.** `verify-desktop-version.py` checks macOS Debug and
   Release, Windows package/Tauri/Cargo manifests and Cargo.lock together.
   Six refusal/consistency tests cover drift and missing/duplicate inputs.
6. **Reproducible local checks.** `test-desktop-stability.py` retains full output,
   commands, return codes and before/after source hashes. It does not pipe build
   failures through `tail`, refuses root, strips privileged fixture opt-ins and
   always records `release_accepted: false`.

## Evidence: 2026-09-08 local checkpoint

Run from the isolated tree:

```sh
python3 tooling/scripts/test-desktop-stability.py --expected-version 0.0.72
```

All **15 local checks** exited zero with no source changes during the run.
Full logs and the exact tested source fingerprint:
`artifacts/stability-0072/20260908T060357Z/report.json` and
`source-before.json` / `source-after.json` (ignored local evidence).

| Check | Result and limitation |
| --- | --- |
| Product-version consistency | All six surfaces are 0.0.72; six gate tests pass |
| macOS XCTest | 193 total, 192 passed, 1 script-emission skip, 0 failed; xcresult summary retained |
| ConnectionCoordinator tests | 10 tests including eight new queue/cancellation/state-order tests; no real helper used |
| Mac umbrella suite | 12 suites passed, 0 failed, **6 explicit privileged/real-network skips** |
| macOS Release build | Unsigned build succeeded; not signed installation acceptance |
| Helper self-test | Unprivileged self-test passes; PF parsing skipped |
| Portable Rust core | 218 unit + 10 integration tests pass |
| App Rust on Mac | 421 pass, using `clippy` feature to skip Tauri packaging |
| Service model tests | 305 pass, `standalone,client,test`; no real Windows WFP |
| Frontend | Typecheck + 196 tests; 84 development/packaging tests |
| Worker | Typecheck + 328 tests; fixture credentials, not deployed Access qualification |
| Policy contract | 4/4 pass; negative-control fixture correctly fails |
| Windows Service production cfg | Cross-target `cargo check` of lib and bins succeeds **without** `test`; DNS engine/WFP code is type-checked, not executed |

The initial `--all-targets` Service cross-check tried integration tests without
their required `test` feature and failed. The production-only check intentionally
uses `--lib --bins --features standalone,client`; model/integration features must
not replace production cfg coverage. Windows App cross-check is externally
blocked by missing Windows SDK headers (`windows.h` in aws-lc-sys). No TLS or
dependency feature was weakened to work around this.

The six Mac umbrella skips are: root PF parse, helper lifecycle, staging refusal,
Core lifecycle, signed helper install lifecycle, and real isolated data plane.
The XCTest skip is separate: install-script emission was not requested.

## Second stabilization slice: account/catalog read ownership

Controlled URLProtocol tests reproduced the following before correction:

- An old `auth/methods` error replaces an authenticated `.ready` screen.
- An old account entitlement error changes a signed-out screen to `.suspended`.
- An old `/me` success replaces another user's identity, and an older parallel
  request overwrites a newer usage result.
- An old catalog crosses the account boundary into the consumer (which otherwise
  labels the response with the account current **at consumption time**).
- Cancellation of a policy read is stored as an outage and retried.

AccountSession now owns a read-context revision. State/identity transitions and
explicit stop/logout/clear retire outstanding reads; request completion checks
that revision before publishing both success and failure. Account refresh also
requires the same owner ID and the latest request ID. Catalog checks surround
consumer invocation; its existing single-flight cancellation/drain stays intact.
Policy cancellation no longer records an outage or retries. Signed-out callers
cannot initiate authenticated catalog or policy reads.

`AccountSessionRequestTests` uses held local responses, not timing sleeps or live
servers. Request arrival waits are bounded by five seconds. Authenticated cases
use synthetic tokens in a unique per-test keychain namespace and remove them in
fixture cleanup; production account credentials and real runtime teardown are
not used. Current successes and current entitlement/failure handling remain
covered, alongside old-success, old-error, cancellation, same-account re-entry,
and the 401/refresh/401 path.

Reproduction logs are retained under `artifacts/stability-0072/`:
`account-race-red.log`, `account-refresh-red.log`, `catalog-race-red.log`.
The final focused test log is `account-catalog-final.log`. The root-only diff
against the handoff archive is `account-catalog-root.diff`.

This is **read-result fencing**, not a claim that authentication/token mutation,
device management or every consumer's internal transaction is now serialized.
Those remain separate review targets; no protocol or keychain format changed.

### Verification-discovered test clock defect

The first complete run of this slice, `20260908T062826Z/report.json`, reports
**14/15** successful commands and unchanged source hashes. macOS has **214 tests,
213 passed, 1 skipped, 0 failed**, with its xcresult summary retained beside the
report; unsigned Release also builds. Do not turn that overall failed report
into a pass: one Worker rollout test expected 503 after an acknowledgement but
received 200 when real scheduling had already crossed the credential's second.

The test now controls `Date.now` locally, explicitly exercises both 0 ms and
999 ms offsets, verifies the equal-second acknowledgement is refused, then
advances exactly one second and verifies acceptance. The clock is restored in
`finally`; no production Worker, schema, authentication or readiness rule was
changed. Both boundary cases pass in `worker-rollout-clock-green.log`. The corrected full
run `20260908T063246Z/report.json` passes **15/15** commands with unchanged
source hashes, including **329 Worker tests** and all **214 macOS tests** (one
explicit skip). This is the second local checkpoint, not release acceptance.

## Third stabilization slice: credential ownership and CI gates

Four controlled-response cases reproduced credential mutation races in
`TonoAPIClient`: an old refresh overwrites a new sign-in, an old logout deletes
new credentials, an old 401 renews the replacement account, and a late 401 can
rotate the token while logout is revoking it (`credential-race-red.log`).

The actor now versions credentials, owns refresh/logout task identities, and
blocks ordinary authenticated requests while logout drains an existing rotation
and revokes the newest token. Adoption retires an old refresh; old completions
cannot clear a newer task or its credentials. Logout itself remains uncancelled
by a view closing. Positive tests retain normal renewal/retry, logout renewal,
invalid-adoption refusal and rotation-before-revocation behavior. The focused
account suite has **30 tests** (`credential-final.log`). The complete local run
`20260908T064513Z/report.json` passes **15/15** commands with unchanged source
hashes, including the unsigned Release build. This is the pre-candidate checkpoint;
Windows native and hosted privileged tests have not yet been run on this source.

The existing Windows CI real-engine test could silently skip an unavailable WFP
engine and report green. Its CI invocation now requires the engine, checks the
exact expected test exists before running it, and treats inability to qualify as
a failure. This remains a narrow **permit-filter shape/cleanup** test, not a
full block/leak/DNS/reboot qualification. CI also checks both desktop product
versions agree. No workflow publishes or updates customer channels.

The owner explicitly authorized **candidate commits, pushes, CI execution and
merge after successful verification** on 2026-09-08. This supersedes the earlier
no-commit boundary, not the no-publish/no-host-network boundary. Follow
`RELEASE_LINES.md` for ordinary merges; retain the dirty original main worktree.
Remote main is now `1648e10`; its additional UI/motion work must be merged and
retested rather than overwritten. GitHub currently has a **draft** `v0.0.72`;
no release/tag/feed is changed by candidate testing.

## Remaining work / release gates

- Continue the AccountSession lifecycle review beyond the API credential fixes:
  overlapping sign-in/runtime completion versus logout, device inventory/revoke
  completion ownership, and policy revision diagnostics.
  These remaining paths have **not** been declared race-free.
- Finish macOS connection-domain ownership through narrow interfaces rather
  than a whole-file implicit-self rewrite. The remaining task fields and account
  extensions still expose too much mutable state; no completed-M1 claim.
- W3 shared client/service-client extraction and sidecar-path retirement remain
  separate behavior-sensitive work. Do not hide their absence with file counts.
- Windows native App build/tests, real administrator WFP/DNS/recovery testing,
  real installer and upgrade qualification are still required.
- Isolated Mac privileged PF/helper and signed install/upgrade, and actual
  fail-closed/leak/restore testing remain required. Local unsigned checks are
  not substitutes and do not authorize touching the owner's active network.
- No new version/tag/feed was published. Confirm existing immutable release
  history before packaging; never overwrite a published 0.0.72 tag/installer.
- Worker and Linux remain separate milestones; neither should expand this
  desktop stability slice. No new Linux capability is enabled.

## Candidate history

- `e8ebf1a`: preserves the incoming structural work and the three local stability
  slices on `stability/desktop-0.0.72-20260908`. Redundant trailing blank lines in
  16 newly split Rust files were removed at the staged whitespace gate; no Rust
  logic was changed by that cleanup.
- Upstream `origin/main @ 1648e10` is integrated by a normal merge. Its
  24-file UI/motion change is retained. Conflict resolution keeps the extracted
  theme/node modules, removes the retired connecting-yellow token in its new
  theme owner, and applies the new accent in `ProxiesView+Nodes` rather than
  restoring the old giant view. The merged source passed all five selected platform checks in
  `20260908T065052Z/report.json`, with unchanged source hashes (version gate,
  frontend types/tests, Mac umbrella, unsigned Release). Hosted CI follows.

## Fourth stabilization slice: account lifecycle and installed-state ownership

A dedicated `AccountLifecycleCoordinator` now owns login/restore/runtime work
and serialized logout/direct-internet cleanup. Duplicate submits join, cancelled
work drains before cleanup, and a new sign-in cannot cross the cleanup barrier.
Cleanup survives a closing view. A cancelled, non-cooperative authentication
response is checked before credential adoption; the API actor also refuses
adoption by an already-cancelled task.

Device inventory, revoke errors and policy refreshes now check their account
context and latest request. Policy diagnostics report the revision actually kept
by the install owner, not a stale response's advertised revision. Runtime-monitor
cancellation drains before teardown; cancelled cloud fallback cannot re-arm
protection. The home monitor starts after the ready-state context is established.

Controlled red cases are retained in `authentication-cancel-red.log`,
`device-policy-red.log`, and `fallback-cancel-red.log`. The account request suite
has 39 tests and its new lifecycle coordinator has six: all 45 pass in
`account-completion-final.log`. The complete local checkpoint
`20260908T072743Z/report.json` passed 15/15 commands with unchanged source hashes.
The subsequent home-monitor startup-order adjustment is checked in the next run,
not retroactively attributed to that checkpoint.

## Hosted qualification on the candidate branch

- Normal upstream merge: `1c71b656775f8e65e382a4af3ae7a82a1fe52580`.
- macOS CI passed: https://github.com/raydocs/tono/actions/runs/34196733366
  including unsigned builds/tests and hosted privileged PF parse, helper
  lifecycle, staging refusals and Core lifecycle. No owner-machine network was
  changed. Signed installer and real protected data plane are still separate.
- Services CI passed: https://github.com/raydocs/tono/actions/runs/34196733359
- Native Windows CI initially found three cfg/import errors hidden by Mac model
  tests. `b1862d133c03ab281120549767484db18c7bd6e3` fixes those imports without
  weakening features. All four jobs then passed:
  https://github.com/raydocs/tono/actions/runs/34197878122
  Native App has 412 passing tests. The required real WFP engine test executed
  and passed (one test, not a skip); it checks permit shape/cleanup, not leaks.
  Full successful/failed hosted logs are retained under `artifacts/stability-0072/`.

## Candidate packaging identity correction

The old Windows prebuild fetched mutable upstream `latest`, or reused any cached
Core, then copied the committed **patched** identity without checking the binary.
Hash-pinning that arbitrary binary into Service did not prove its identity.
Windows prebuild now requires the audited Core and verifies its executable
version, Windows/amd64 platform, Go version and exact build tags. Stock releases,
wrong patch/toolchain/platform/architecture, missing or extra tags are refused.
Nine identity tests join the packaging suite (93 tests total).

`windows-core.yml` uses the existing pinned upstream commit, Go version and
reviewed adaptive patch, runs patch tests, cross-builds Windows Core and checks
identity metadata is unchanged. Both release and non-publishing candidate
workflows consume its same-run, same-SHA artifact. Other platforms' download
behavior is unchanged. Native Windows prebuild now fails clearly when this
required input is absent; it never substitutes upstream latest.

`windows-candidate.yml` builds a real NSIS candidate, inspects its extracted
payload and retains hashes/source identity as Actions artifacts only. It has
read-only repository permission, no signing secret, no release environment, no
release/tag action and no update-feed publication. The installer is explicitly
**not updater-signed or Authenticode-qualified**. A successful candidate build
will not by itself close Windows physical install/upgrade/network acceptance.

The earlier “remaining” lifecycle/device/policy and native-compile items above
are superseded by this evidence; architectural M1/W3 completion and physical
installer/data-plane qualification are not being claimed.

The next complete local run, `20260908T073309Z/report.json`, passes 15/15
commands with unchanged source fingerprints, including the final home-monitor
startup ordering, unsigned Release build, and 93 packaging tests. XCTest has
238 total, 237 passed, one explicit script-emission skip, zero failures. The
Windows CI frontend job now runs the packaging/identity contracts on every
app change as well, not only during installer preparation.

## CI failure audit and final recovery checks

The owner's CI-error report was checked against both current and failed runs:

- `34196733304`: the three native Windows imports fixed in `b1862d1`;
  the succeeding run and its raw log are linked above.
- `34156921190`: old macOS release line still looked for LiquidClash and
  Sparkle 2.9.4. The candidate already uses Tono and pinned Sparkle 2.9.6.
- Dependabot `34126874163` / `34125079759`: nested Cargo lockfiles would change
  under `--locked`; `34125861503`: upgraded Monaco removed createWebWorker;
  `34125734238`: Worker Vitest peer-dependency conflict. These are separate
  upgrade branches, not failures of the candidate's frozen dependency set.
  No `--force`, `--legacy-peer-deps` or removal of `--locked` was used.

Review also found Sparkle ships **two** files named `sign_update`: its modern
`bin/sign_update` and `bin/old_dsa_scripts/sign_update`. The local publisher
refused this ambiguity; the hosted publisher silently picked traversal order.
Both now use one read-only selector that accepts only executable modern
`bin/sign_update`, including owner-only permissions, and rejects zero/multiple
modern tools. Six tests pass, real cached 2.9.6 artifacts select the modern tool,
and all 25 appcast publisher tests pass. No signing key or release dispatch was
used during this audit.

A final cancellation review reproduced a stuck startup presentation after the
user requests direct-internet recovery: cleanup drained the startup task, but an
already-adopted account could remain restoring/authenticating/enrolling forever.
Two failing tests are retained in `interrupted-startup-red.log`. Cleanup now
returns an unowned account to sign-in and an incompletely initialized account to
an explicit retryable state; it never claims that partial startup is ready.
A third test preserves existing ready/suspended/error states. These presentation
checks invoke no real helper, DNS or firewall operation.

The first final recovery run (`20260908T074235Z/report.json`) correctly failed
the localization coverage test: the new retry message lacked Chinese text. Its
241-test xcresult (one failure) is retained. The translated zh-Hans unit is now
added; do not describe that failed checkpoint as a pass.

The corrected recovery checkpoint `20260908T074456Z/report.json` passes all
three affected checks (Mac umbrella, unsigned Release, policy contract), with
unchanged source fingerprints. macOS now executes 241 tests: 240 pass, one
script-emission skip, zero failures. The extra three account presentation tests
pass alongside all previous cancellation/credential tests. Sparkle selection's
six tests and appcast publisher's 25 tests were separately retained as green logs.
