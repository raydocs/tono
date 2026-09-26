# Decisions

One entry per decision that used to wait for the owner. Newest first. An agent that
meets such a question chooses the stricter, non-leaking option (see
[AGENTS.md](../AGENTS.md)), adds an entry with status `provisional`, and continues.
Only the owner changes an entry to `owner` or `reversed`.

Status values: `owner` (the owner decided), `provisional` (an agent chose; the owner
may reverse), `reversed` (keep the line; say what replaced it).

```text
## YYYY-MM-DD · question in one line
- Status: provisional | owner | reversed
- Chosen: the option taken, and the option rejected
- Why stricter: what it does not widen (exposure, data, availability)
- Applied in: PR / commit / command
```

## 2026-09-26 · Which version is the customer release?

- Status: owner
- Chosen: 0.0.74 / macOS build 74 (owner: "74"). The `tono-macos-0.0.73-build73` tag and the
  0.0.73 internal candidates stay as history. Rejected: reusing build 73 (its tag already
  points at another commit).
- Applied in: [#660](https://github.com/raydocs/tono/pull/660).

## 2026-09-26 · Does #352 / H2-F3 (Windows Service IPC not bound to the Tono image) block 0.0.74?

- Status: owner
- Chosen: no. 0.0.74 ships H2-F3 as a known limitation; #352 merges after the owner's Win11
  `icacls` / owner evidence (last step of the device round), for 0.0.75. Rejected: holding the
  release for that evidence.
- Why: owner, 2026-09-26. Not a regression; the caller must already run code as the signed-in user.

## 2026-09-26 · G4.2 for 0.0.74: is an old-client first hop required before the customer feeds move?

- Status: owner
- Chosen: no. The owner has no device kept on 0.0.67 / 0.0.34; customers uninstall and install
  0.0.74 directly. G4 publishes the owner-accepted kit bytes (success target) to the customer
  feeds, then the owner checks the published build; Windows still requires the release row's
  `verifiedAt` before promotion. Rejected: holding the Windows publish for a pre-promotion
  old-client path (0.0.34's update endpoint is fixed in production).
- Why: owner, 2026-09-26.

## 2026-09-26 · SHIP_PLAN §6 "macOS Sparkle 真机一次成功更新" under the v1 update path

- Status: owner
- Chosen: the macOS v1 protected update success in the G3.3 device round satisfies that line;
  the §6 checkbox text itself is unchanged (agents never edit it). Rejected: a separate
  Sparkle-only device test.
- Why: owner, 2026-09-26.

## 2026-09-26 · Windows: may the installer or the App's repair re-enable a Disabled Base Filtering Engine?

- Status: provisional
- Chosen: no. `tono-service-install.exe` starts a BFE that is only stopped (its start type
  unchanged) and waits out StartPending, before the manual gate's first WFP read. A BFE whose
  start type is Disabled is left as it is: the gate refuses with exit 79, NSIS shows the
  `sc.exe config BFE start= auto` / `sc.exe start BFE` commands, and the App's repair fallback
  text names the same commands. The silent `sc config BFE start= auto` the helper used to run
  (it never ran with BFE stopped once the manual gate read WFP first, b6b42ea0) is removed. Rejected: re-enabling it
  silently (the old behaviour), or after an NSIS Yes/No prompt like the orphaned-block (78) one.
- Why stricter: the installer changes no machine setting the user or their security software
  chose; the user makes that change. Protection is not loosened: an unreadable WFP still
  refuses the gate, and a stopped (not Disabled) BFE installs as before the regression.
- Applied in: [#658](https://github.com/raydocs/tono/pull/658) (H22-O-F1)

## 2026-09-26 · May the G3 test kit use the production v1 update pointer before G4?

- Status: owner
- Chosen: yes. The one-round G1–G3 test kit publishes its signed update pair behind
  `releases.afk.ccwu.cc/desktop/v1/latest/manifest.json`, which no shipped customer build
  reads (0.0.67 / 0.0.34 use Sparkle `public/appcast.xml` and `public/windows/latest.json`).
  Customer feeds stay untouched until G1–G3 are ticked. Rejected: testing G3 only after
  publish, a second device round.
- Why: owner, 2026-09-26 in chat; conditional on the plan review confirming no shipped build
  reads the pointer. The kit's own builds do read it (NativeUpdateDownload.swift:5,15;
  update_wire.rs:5), so the pointer is left on the kit's success-target package, which is the
  exact candidate the owner accepts and G4 publishes; nothing else is placed behind it before
  G4, and the kit's release sequences are the ones the published build continues from.
- Applied in: G1–G3 test kit (this session).

## 2026-09-26 · May the agent approve the `windows-release` environment for test-kit signing?

- Status: owner
- Chosen: yes, the agent approves the signing runs of the test kit with `gh`, and records
  each approval (run id, source SHA) in `docs/changelog.d/`. Rejected: waiting for the owner
  at the computer.
- Applied in: G1–G3 test kit (this session).

## 2026-09-26 · Does #331 (macOS bootstrap exception not bound to Tono) block the customer release?

- Status: owner
- Chosen: no. The customer release (0.0.74, see above) ships with H1-F5 (macOS half) as a
  known limitation in the release notes; #331 continues from plan v5 for 0.0.75. Rejected:
  holding the release for a helper/PF redesign rejected five times in plan review.
- Why: owner, 2026-09-26. Not a regression (present since 0.0.67); reach is limited to
  shared control-plane anycast addresses while Protected Offline.

## 2026-09-26 · Windows: which vault session does the next launch trust after a sign-in that did not finish saving?

- Status: provisional
- Chosen: a sign-in always marks the local session marker pending (also over a
  committed marker) before it retires anything, and commits it only after the new
  session is durable in the vault. A sign-in that ends before its session reaches
  the vault (release refused, superseded, `client.adopt` failed) puts back the
  marker as it was before any sign-in was in flight, because the vault still holds
  what that marker described; a pending marker it puts back belongs to an adopted
  sign-in whose commit task is still running. Once `client.adopt` has queued the
  new session, a crash or a commit that never lands (the commit task retries until
  the process exits) leaves the marker pending, and the next launch treats the vault
  session as not owned: the user signs in again, through main's existing
  unowned-session path, which releases stored protection when the Service reports
  it armed. Rejected:
  restoring the previous account's committed marker after the new session was
  queued, which would let the next launch silently restore the previous account or
  trust a session that never reached the vault.
- Why stricter: once a switch has handed its session to the vault, no account is
  resumed unless this installation proved that session durable. The cost is a
  re-login. No new sign-out or release path is added; the existing unowned-session
  path handles the case.
- Applied in: [#642](https://github.com/raydocs/tono/pull/642) for
  [#409](https://github.com/raydocs/tono/issues/409).

## 2026-09-26 · May macOS dial the cached catalog before Tono has verified the account?

- Status: provisional
- Chosen: no. Connect (and every protected reconnect, wake recovery and Retry through it)
  needs Tono to have accepted the session in this process (a 2xx answer, `me()` readmitting
  the account, or a sign-in) or an offline admission on a matching grant. A launch still
  restoring waits for that; a restore that fails without a grant stays in error with PF held
  until Retry succeeds. Rejected: dial the cached exit whenever no offline grant is in play
  (previous behavior).
- Why stricter: no exit is dialed for a session no server accepted and no grant admitted.
  Availability narrows only for a crash-recovery launch during restore and an unverified
  error state, both already fail-closed.
- Applied in: [#652](https://github.com/raydocs/tono/pull/652) (R612-O5).

## 2026-09-24 · When may an agent merge a PR without asking?

- Status: owner
- Chosen: merge automatically when CI is green on the exact head for every touched
  tree; the jev-route review depth for the diff passed (cross-vendor for protected
  paths); no review threads are unresolved; the recorded merge order is respected
  (stacked PRs base-first); and a combined regression review runs on `main` after
  each merged batch. Rejected: a per-PR owner approval.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 1;
  [.jev-route.json](../.jev-route.json) protected paths.

## 2026-09-24 · May an agent deploy and publish?

- Status: owner
- Chosen: yes, automatically: Worker deploy via the deploy script, secrets, remote D1
  (migrations only through the script; ad-hoc writes only when the task names them,
  after an export), and customer channel publish. Customer publish only after the
  owner has written `[x]` for G1, G2 and G3 in [SHIP_PLAN.md](SHIP_PLAN.md) §6 with
  evidence links; agents never edit those lines. Rejected: owner runs every deploy
  and publish.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2. Agent-added limits on
  secrets and candidate identity are the `provisional` entries below.

## 2026-09-24 · Who makes product decisions that used to wait for the owner?

- Status: owner
- Chosen: the agent chooses the stricter, non-leaking option, records it here as
  `provisional`, and continues. Rejected: stopping the work to ask.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 3.

## 2026-09-24 · hy2 blocks in the customer catalog before client admission is proven

- Status: provisional
- Chosen: keep ` · hy2` stripped from customer catalogs and do not PUT hy2 blocks
  until client admission is on `main` and the owner has supplied the
  `HY2_CATALOG_EMAILS` value (never committed); bump the catalog revision after
  changing it. Rejected: publishing hy2 blocks to internal accounts first.
- Why stricter: no customer sees a transport the shipped clients cannot admit.
- Applied in: [SHIP_PLAN.md](SHIP_PLAN.md) §3 item 5.

## 2026-09-24 · Where may a secret value come from?

- Status: provisional
- Chosen: `wrangler secret put` with an owner-supplied value, or a CSPRNG value
  for a Tono-controlled secret the task names for creation or rotation, after
  coordinating its consumers (a JWT key change signs users out; an admin token
  change affects the hub and scripts). Third-party credentials (for example the
  Telegram bot token) are never fabricated. No secret is printed or committed.
  Rejected: every secret value supplied by the owner.
- Why stricter: an agent never invents an external credential, and a rotation
  never happens unless a task names it.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2.

## 2026-09-24 · Does the G1–G3 acceptance cover a different candidate?

- Status: provisional
- Chosen: no. The owner's G1–G3 evidence names the candidate (source SHA,
  version/build, package hashes); customer publish uses only that candidate. Any
  other SHA or version needs new owner evidence, except rebuilding an
  already-published good source as a higher build for rollback. Rejected: any
  0.0.73 build inherits the ticks.
- Why stricter: customers only receive bytes the owner accepted on a device.
- Applied in: [AGENTS.md](../AGENTS.md) "Finish the work" item 2;
  [RELEASE_LINES.md](RELEASE_LINES.md#customer-publish-g4).
