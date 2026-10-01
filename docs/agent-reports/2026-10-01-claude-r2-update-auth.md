# Round 2 hunt: Windows update/install path and control-plane auth — 2026-10-01

Scope: (a) Windows update and install path: `apps/windows/service/src/core/update*.rs`,
`update_transaction.rs`, `bin/install_service.rs` and `install_service/update_executor.rs`, the NSIS
`installer.nsi`, the App's native update caller (`app/src-tauri/src/tono/commands/update.rs`) and the
release-trust chain (`desktop-update-v1.mjs`, `windows-package-components.mjs`, the candidate and sign
workflows). (b) Control-plane auth and account: email and OIDC sign-in, sessions, refresh, logout
(including #833), device registration and limits, account close, ops/admin auth and role gates.

Baseline: origin/main `626b1d74`. Code reading, `gh pr diff`, git history. Local checks: Node tests only.
Nothing ran against PF, DNS, routes, the helper or system services; no native `cargo`, no deploy.

Severity follows `codex-r4-prompt-RegLate.md` (strict): P0 = single plausible failure → network loss,
crash, broken sign-in/session, billing corruption or data exposure; P2 at most for two independent
failures, administrator misconfiguration or a millisecond race.

## Result

- **No new P0 or P1 found** in either module.
- Fixed: R2UA-F1 (P3, release-trust tooling) on branch `hunt/claude-r2-candidate-measure`.
- Real, unfixed: R2UA-F2 (P2), added to the Windows update P2 tracker #1055.
- 13 other hypotheses rejected (below).

## Findings

| ID | Area | Sev | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R2UA-F1 | release trust | P3 | `.github/workflows/windows-candidate.yml:168-180` | The paired candidate step (`desktop-update-candidate.yml` → `windows-candidate.yml` with `update_release_sequence`) looks components up by file name in the 7-Zip extraction. Since #658 the package also holds `$PLUGINSDIR/tono-gate/resources/tono-service.exe`, so `tono-service.exe` matches twice and the step throws. It also never passes `--sing-box`, so a manifest built from it lacks `singBoxSha256` and the Service's `components(payload) == target.components` check (`core/update.rs:529-533`) would refuse every #1159 package. The workflow has never run. | fixed on `hunt/claude-r2-candidate-measure` (uses `windows-package-components.mjs`, as `desktop-update-sign.yml` does) |
| R2UA-F2 | Windows update | P2 | `service/src/bin/install_service/update_executor.rs:347-472` | After `Install` spawns the executor and records `Launching`, nothing supervises it. An executor that exits before it stops the Service (AV kill or crash, `repair already running`, image/binding refusals, receipt expiry, `staged components changed before consume`) leaves Core stopped and bootstrap Blocked WFP, with no automatic release. The App folds to Protected Offline (`commands/update.rs:270-285`) and the user's Restore internet (`DisconnectApplyingNarrow`) does release with the AI hold, so recovery is manual, not absent. A Service restart only returns `Launching` to `Staged` (`core/update.rs:1616-1633`). Sibling of WIN-UPDATE-SPAWN-FAIL-BLOCK's residual (`image()` failing after the process exists). | real, unfixed: needs an App- or Service-side executor watchdog plus a decision on which pre-stop refusals (tamper/expiry) should stay fail-closed; added to #1055 |

## Rejected hypotheses (false positives)

1. **#833 sibling revocation kills a second client on the same device.** Only the macOS App
   (`TonoAPIClient.swift`, `OfflineGrant.swift`) and the Windows App (`tono-core/src/auth.rs`,
   `transport.rs`) refresh; the Windows Service holds no session. One chain per (user, installation) is safe.
2. **#833 rotation revokes the winner's session on a lost race.** `retireSiblings` is gated on
   `successor_id = sid`, set by the first statement of the same batch (`sessions.ts:36-41`).
3. **Refresh grace replay revives a logged-out chain.** Logout follows successors and revokes every
   session of the device (`index.ts:2462-2476`); a replay then finds a revoked successor and returns 401.
4. **Account switch on one installation mixes sessions or devices.** Devices are keyed by
   (`user_id`, `installation_id`) (`index.ts:1108`); sessions join their own user and device.
5. **Closed or disabled user can sign in again.** Email (`accountForVerifiedEmail`), linked OIDC and
   `completePasswordlessAuth` all check `ineligible`; close disables, revokes devices and sessions, and
   deletes exit credentials in the same flow (`ops/shared-admin/catalog.ts:37-91`, `enforceUser`).
6. **Email OTP brute force.** 5 attempts per challenge, 5 starts per email and 20 per IP per 15 min,
   HMAC-bound to the challenge id; undelivered codes are consumed. Rate remains about 2,400 guesses per
   day per email from many IPs (≈0.24 %/day) — accepted design, not a single-failure takeover.
7. **OIDC verification gaps.** RS256 only, issuer, audience/azp, exp/iat, nonce bound to a hashed
   single-use challenge, JWKS size and kid checks (`oidc.ts`). Google non-Google-domain linking is #789.
8. **Ops role gate bypass through shared-admin.** Every `sharedAdministrativeResource` route has a row
   in `SHARED_ADMIN` (`ops/access-roles.ts`); unknown paths default to owner. The admin Worker blocks
   cross-site writes before stripping `origin` (`admin-worker.ts:74-90`).
9. **Cloudflare Access verification.** Issuer, audience, exp/iat/nbf, RS256 JWK and the admin email set
   are all enforced (`access.ts`).
10. **#1159 introduced-member rollback leaves scratch that blocks the next update.** Publish moves the
    `.publish` copy onto the target (`MoveFileExW`), and rollback deletes the introduced file; no
    `.rollback` exists for an introduced member (`install_service.rs:1225-1315`).
11. **#1159 plan field breaks the old Service.** 0.0.73 Windows has no v1 native update contract or plan
    reader (`git ls-tree tono-desktop-0.0.73-rc.20260922.1`), and the current `PlanMemberView` reads
    `introduced` with `serde(default)`.
12. **`Components.deny_unknown_fields` rejects `singBoxSha256` on old v1 readers.** Real, already #1240.
13. **Hardcoded `Program Files\Tono` in the non-replace sing-box pin check refuses custom install
    directories.** NSIS forces `$INSTDIR` to `$PROGRAMFILES64\Tono` for the machine install
    (`installer.nsi:731-738`), and the Service helper already pins that path (`install_service.rs:950`).

## Areas covered and not finished

- Covered end to end: the control-plane auth routes listed above; `update_executor.rs` `execute`,
  recovery classification and both release finalizers; `core/update.rs` Prepare, Install, Disconnect,
  plan readers and `reconcile_before_desired`; the #1159, #1163 and #1172 diffs in the context of main.
- Read only in part: `update_transaction.rs` (store and capture/consume paths), `security.rs`,
  `uninstall_service.rs`, the full NSIS script and the App `update_handoff.rs`. The 25 Windows update PRs
  merged since 2026-09-30T23:30Z were listed; #1159, #1163 and #1172 were read in full, the rest only
  where `execute` and `request` reach them.
- Not runnable here: Windows `cargo test`, SCM/WFP/NRPT behavior, installer runs. No new control-plane
  test was needed because no control-plane change was made.

Hunter: Claude Opus 5.5
