# macOS native update transaction — #26 / G3

This is implementation, not installed-device acceptance. It starts from the
shared integration source `23c22a3d95f6edb12d067ab5c686b22626cece9e`; shared models,
packaging and workflows belong to the integration branch. No release signing,
deployment or feed promotion is part of this change.

## Active call chain

`AppUpdater` discovers the detached manifest/signature, asks the authenticated
Helper to verify the offer, confirms through native AppKit, and downloads the
single actual package. `AppState.installNativeUpdate` calls
`NativeUpdatePreparation` → `PrivilegedRuntimeCoordinator` → authenticated
`HelperManager` IPC. There is no Sparkle installer or legacy fallback.

`SocketServer` serializes every runtime request and updater operation under the
root store's cross-process flock. `UpdateTransaction` reserves before private
staging, captures the actual protection obligation, and delegates preparation
to `UpdateRuntime`. Core/TUN stop, DNS persisted/active readback, proxy readback,
and retained PF are native observations, not App claims. `execute` atomically
persists consumption and sequence high-water before registering the executor.
A lost acknowledgement queries the same consumed attempt, including repairing
its executor registration, never making a second grant.
Every ledger read re-syncs the containing directory before returning a grant.
A rename followed by a failed directory sync therefore cannot authorize
executor registration/startup, successor runtime mutation or retirement until
durability is re-established. Merely observing candidate bytes is insufficient.

`UpdateExecutor` is a private copy of the old signed helper, registered as an
independent launchd job. It waits for the initiating process to exit, rechecks
the staged package and offline runtime, persists `replacing`, then replaces the
App, Core and Helper. A restart at `replacing` or `rollingBack` restores retained
original assets instead of repeating forward installation. Daemon startup
reconciles the private ledger before normal Core/PF restoration. Successful
replacement launches the new App; only the authenticated successor can recover
and commit. Rollback assets and consumed high-water survive failures and commit.

## Native identity and build input

Only `/Applications/Tono.app` registers. Peer UID comes from `getpeereid` and the
process incarnation from `LOCAL_PEERTOKEN` plus kernel boot UUID. The root verifier
requires the existing Tono Developer ID team, identifiers, strict/all-architecture
sealed signatures and absent `get-task-allow`, then checks actual component bytes.
The initial manually installed bundle may be owned by that authenticated user
or root; writable/shared component directories and other owners are refused.

`UpdatePackage.sameCode` calls `SecCodeCheckValidity` on a fresh dynamic SecCode
before comparing `kSecCodeInfoUnique` with the checked installed static image.
The dynamic check is essential: signing-information lookup alone reads disk;
Apple's kernel/static CDHash comparison rejects the old mapped process after
path replacement (`errSecCSStaticCodeChanged`). The same boundary verifies the
running Helper. Thus another old App at the same path cannot adopt the update.

Pass `TONO_UPDATE_RELEASE_SEQUENCE=<positive safe integer>` to the existing Xcode
build/archive command. `scripts/write-build-source.sh` writes it with Git commit
metadata into `Contents/Resources/tono-build-source.json`, sealed by the App
signature. Missing sequence is null and refuses automatic-update admission; no
runtime environment value overrides the installed floor. The detached manifest
must match this resource, App version and all three final signed executable
hashes. Helper behavior capability is 4.5.0 (4.4.0 already belonged to DNS).

## Pending and failed attempts

Ordinary connect/watchdog, helper upgrade/repair/reset and quit release cannot
overtake a pending attempt. The adopted connected successor alone can restore
its route; Protected Offline does not auto-connect, including Home transport.
Cancellation is pre-consumption only and records a block. Explicit Disconnect
has separate durable requested/verified facts and performs privileged cleanup;
it never rewrites the recovery obligation, erases consumption or claims commit.
Corrupt, expired, blocked and changed-incarnation states remain diagnosable and
fail-closed. Automatic recovery does not silently bless a manual replacement.
Blocked evidence is deliberately not garbage-collected or cleared by reinstall.

The native error alert offers **Keep Protection** (default) or **Disconnect and
Retry** for an unconsumed reserved/staged attempt. The latter performs privileged
Disconnect and then `/update/retire`. Root authenticates the original installed
components, registered location and owner, requires durable requested/verified
Disconnect and fresh unprotected runtime readback, then durably archives the
receipt before clearing its active pointer. Failed/cancelled reason, original
recovery obligation, private assets, generation and high-water remain retained.
A new attempt gets a new identity/generation; consumed/uncertain installation
cannot use this path. Retirement does not pretend the failed attempt committed.

## Production-bound verification boundaries

Native execution belongs on the existing hosted `macos-26` lanes:

```sh
tooling/scripts/build-core-helper.sh
sudo apps/macos/Tono/Resources/tono-core-helper --update-self-test
xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono \
  -configuration Debug CODE_SIGNING_ALLOWED=NO \
  ENABLE_USER_SCRIPT_SANDBOXING=NO test
```

The root tests run the actual private-file copy, pinned-key signature refusal,
durable store, transaction consume/reconcile/commit decisions, executor recovery
control flow and real replacement/rollback renames in temporary directories.
They inject live native-signature success, network observations, launchd and
selected write failures; unsigned contract fixtures are not admitted through
the production signature verifier. A separate native regression launches a copy
of Apple's signed `sleep`, replaces its disk path with `cat`, and calls the real
dynamic-code check while the old process remains mapped. No test signing key or
production environment bypass is added.

The post-rename failure regression uses the real atomic writer through rename,
then injects directory-sync failure and a failing read-side durability retry.
The real replay boundary must not invoke the substituted executor/repair effect
until a successful sync; consumption/high-water remain a single grant. The
successor regression faults the same boundary after adoption and calls the real
`gate` before any runtime mutation. Retirement exercises the real durable archive,
readback refusal, owner refusal and new-admission generation/high-water behavior;
native authentication/network effects remain substituted in that regression.

XCTest calls the active App ordering boundary for preparation failure and lost
consume acknowledgement. It renders the actual offer/incomplete NSAlerts to
`test-results/renders/native-update-{offer,incomplete,retry}.png` using
ScreenCaptureKit's current-process-only window capture (no desktop capture or
permission request). The first offscreen `cacheDisplay` attempt captured only
icons; its passing PNG-size assertion was not visual evidence. Captures must be
inspected, not inferred from a passing test. The portable metadata-writer
regression is `python3 apps/macos/scripts/test_build_source.py`; it is not native
Swift evidence.

Signed full-bundle success/rollback with launchd replacement, real PF/DNS/proxy
readback, reboot/power faults and connected recovery still need separately
authorized installed-device tests. Hosted injected effects and rendered alerts
do not close G3. Exact source/run/command results belong in the PR evidence.
