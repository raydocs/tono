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

## 2026-09-28 · Who approves GitHub Actions environment approvals (e.g. `windows-release`)?

- Status: owner
- Chosen: agents approve them themselves with `gh` (`windows-release` for any candidate,
  `windows-update-channel` at G4) and record each one (run URL, environment, candidate SHA and
  release sequence) in `docs/changelog.d/`. Rejected: signed candidates outside the test kit
  waiting for the owner's approval.
- Why: owner, 2026-09-28 in chat: "之后都 ai 可以自行批准 不需要我批". Unchanged: customer
  channels move only after the owner's `[x]` for G1–G2 in SHIP_PLAN §6 (0.0.74), and only with
  the candidate that evidence names.
- Supersedes: "May the agent approve the `windows-release` environment for test-kit signing?"
  (2026-09-26), widened from the kit to every run, and RELEASE_LINES' "any other signed G3
  candidate waits for the owner's approval".
- Applied in: [RELEASE_LINES](RELEASE_LINES.md#customer-publish-g4); first self-approval
  [windows-release run 36383440146](https://github.com/raydocs/tono/actions/runs/36383440146)
  (0.0.74 sequence 7422, `ccbc50a8`), recorded in `docs/changelog.d/2026-09-28-regression-a1d498c8-minors.md`.

## 2026-09-27 · Windows installer gate and lock: a Tono adapter that is not present is neither a refusal nor a tunnel

- Status: provisional. The requirement is the owner's (2026-09-27, relayed): a leftover `Tono` adapter must not block
  a reinstall, and it may be removed only if leaving it breaks connecting. The mechanism below is
  the smaller option the owner asked to evaluate (agent, plan PLAN-stale-adapter r3, plan review
  1e546b82).
- Chosen: the manual-install gate, and every other `tunnel_present` / `tunnel_absent` caller,
  counts an interface named `Tono` as present only when Windows reports any status but
  `IfOperStatusNotPresent`; a gate that sees only not-present rows passes and notes them in
  install-gate.log. The WFP lock treats a not-present row, or `ERROR_FILE_NOT_FOUND` from
  `GetIfEntry2` after the alias resolved, as the existing retryable "did not resolve to a LUID"
  state. Nothing is removed. Exit 87 and `TONO_INSTALL_TONO_ADAPTER_PRESENT` stay for a present
  adapter; the 87 dialog no longer sends the user to Device Manager.
- Rejected: A. remove the leftover from the elevated helper (SetupDi `DIF_REMOVE`); B. have the
  Service remove it before StartClash; C. stop the Core gracefully; D. relax only the gate and keep
  `tunnel_absent` strict; E. only reword the 87 dialog; F. remove only a different-device leftover
  at the gate; G. make "tunnel LUID changed" retryable in the App; H. retry every `GetIfEntry2`
  failure.
- Why stricter: a present `Tono` adapter still refuses (a present WinTUN device always has a live
  owner); the tunnel permit is never keyed to a missing or not-present interface; every other
  row-read failure stays a permanent refusal; no privileged device code is added.
- Supersedes: the adapter clause of 2026-09-27 "which leftovers may it clear itself…" (the gate
  still removes no adapter, but no longer refuses a not-present one, and the dialog no longer names
  Device Manager). That entry's status is unchanged.
- Applied in: `fix/win-ghost-tono-adapter-20260927` (WIN-GATE-GHOST-TUN).

## 2026-09-27 · Windows installer gate: which leftovers may it clear itself, and when does the uninstaller hand back its lease?

- Status: provisional (agent). Reason codes on every refusal, and Chinese + English dialogs with
  Russian repeating the English text, are owner decisions (2026-09-27).
- Chosen: the gate clears by itself only a core runtime record whose Core is gone (the pid exited
  or now runs another image) and only when no Tono Service is registered. It does not remove a
  leftover `Tono` network adapter (the dialog says restart, then Device Manager), does not treat an
  unreadable active-owner record or a DNS restore that carries a note as absent, and does not
  auto-retire a stale connected owner (that stays the confirmed 78 path). The uninstaller hands
  its manual lease back at the end of its Uninstall section instead of when its window closes; an
  aborted section keeps the lease as before. Rejected: PnP removal of the adapter from the elevated
  helper, quarantining owner or DNS evidence in the gate, one generic code with the cause only in
  the log.
- Why stricter: residual Tono WFP filters with no Service still need the 78 consent, active
  protection still refuses with 77, and nothing that can hold or re-arm protection is cleared. The
  one automatic clear is a record for a process that no longer exists, with no Service left to
  write another; the earlier lease release follows the section's last change and never an abort.
- Applied in: `fix/windows-gate-reasons-20260927` (WIN-GATE-OPAQUE).

## 2026-09-26 · hy2 on macOS via a separately published SPKI pin

- Status: owner
- Chosen: hy2 must work for every user in 0.0.74, macOS included; fix the pin now (owner).
  Mechanism: each managed hysteria2 block may carry `certificate-public-key-sha256`, the
  standard base64 SHA-256 of the leaf's SubjectPublicKeyInfo, computed by the operator on the
  node and published beside the DER `fingerprint`, which stays mandatory (Windows/mihomo keeps
  using it). macOS passes it to sing-box as `tls.certificate_public_key_sha256`; a block without
  a valid pin stays unavailable. Rejected: deriving SPKI from the DER hash on the client
  (impossible), `insecure: true`, dropping the pin, and shipping macOS without hy2.
- Why: hy2 nodes serve operator-generated self-signed certificates whose private key never
  leaves the node, and the DER pin never relied on a CA, name or validity period, so a key pin
  gives the same MITM protection. Evidence: [product contract](../tooling/scripts/sing-box/product-contract.md).
- Applied in: `feat/macos-hy2-spki-pin-20260926`. Publishing the pins is a separate ops step.

## 2026-09-26 · Does 0.0.74 wait for the G3 protected-update device test?

- Status: owner
- Chosen: no. G3 (protected v1 update: success + interrupted rollback) moves to the 0.0.75
  cycle, where the installed 0.0.74 is the bootstrap and 0.0.75 the update target. 0.0.74 ships
  after the owner's G1 + G2 device round on ONE package per platform (release sequence 7411,
  built from one frozen source). Rejected: the three-package kit (bootstrap / failure target /
  success target) and the signed v1 pointer steps for this release.
- Why: owner, 2026-09-26. Customers uninstall and install 0.0.74 by hand, so no customer takes
  the v1 update path in this release; the first real v1 update is 0.0.74 → 0.0.75. Cost: a
  defect in 0.0.74's update path would surface only then, and customers would reinstall by hand
  again. The SHIP_PLAN §6 G3 lines stay unticked until the 0.0.75 round (agents never edit them).
- Supersedes for 0.0.74: "May an agent deploy and publish?" (2026-09-24) — its publish gate
  needs G1 and G2 only for this release; "May the G3 test kit use the production v1 update
  pointer before G4?" and "May the agent approve the `windows-release` environment for
  test-kit signing?" — no kit this release (the uploaded 7402/7403 objects stay immutable and
  unreferenced; `desktop/v1/latest` stays unset; release-build approvals still follow
  RELEASE_LINES); the G4.2 entry — G4 publishes the owner-accepted 7411 packages; the SHIP_PLAN §6
  macOS Sparkle line entry — that line is part of G3 and moves to 0.0.75 with it.
  AGENTS.md, SHIP_PLAN and RELEASE_LINES carry the 0.0.74 exception next to each G1–G3 gate.

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
  update_wire.rs:5). During the owner's round it serves only the kit's signed pair: the
  failure-target manifest while the owner runs the injected-failure step, then the
  success-target manifest, where it stays until G4; that package is the exact candidate the
  owner accepts and G4 publishes, and the kit's release sequences are the ones the published
  build continues from. Nothing else is placed behind it.
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
