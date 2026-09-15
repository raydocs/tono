# Tono for iOS — native integration draft

iOS/iPadOS **26+**, SwiftUI, native Liquid Glass, `ninx.app`. This is G1/G2
new-platform integration work, **not a qualified VPN or TestFlight release**.
Only `apps/ios` changes. No existing platform, backend, workflow, signing account,
deployment, release line or customer update feed is changed.

## What is implemented, and what is deliberately unavailable

| Surface | This draft | Remaining gate |
|---|---|---|
| Native project | `Tono.xcodeproj`, App + embedded PacketTunnel + unit/UI test targets | Xcode compile/run has not been performed in the Linux Orb |
| Interface | Login, six-state Home, locations, devices, protection settings, hidden technical diagnostics; light/dark system colors and Dynamic Type | Native render, VoiceOver, keyboard, compact/landscape/iPad review |
| Quiet Field | Stable particle identities, spring-interpolated alignment, continuous phase; paused clock for Reduce Motion/low power/offscreen; no Canvas while inactive/backgrounded | Instruments/real-device motion and energy evidence |
| Account | Existing email start/verify, rotating refresh, `/me`, device list and confirmed removal, Keychain session | Execute native mocked-HTTP regressions and approved test-account E2E; no live account writes were performed |
| Locations | Managed-only unavailable state; DEBUG-only selectable fixtures | Catalog admission/parser and stable node identity adapter; no live locations or persisted manual node selection yet |
| Routing | Internal ordered residential failover model, sticky backup, manual pin refusal, explicit entry-fallback grant, required-home block | Not a new wire schema and not connected to runtime; existing cloud routing supplies no ordered backup/fallback grant |
| On Demand | Default-on preference; strict profile factory; pause disables/saves/reloads profile before stopping | Profile install/start intentionally gated **before** system mutation; background protection is unavailable |
| PacketTunnel | Versioned bounded status messages; start always returns an explicit error | Approved embedded sing-box library, platform adapter, tunnel/DNS/health receipts |
| Diagnostics | Bounded typed events, existing telemetry upload API, default comprehensive TestFlight policy, production minimization ceiling, off switch | Native upload receipt/consent review; no background uploader or raw logs |

**The device is not protected by this draft.** Refusing to start an unsupported
tunnel is fail-closed *admission*, not evidence of a system-wide traffic barrier.
Do not describe a failed start as blocking device traffic. The UI never derives
Protected from a start call or `NEVPNStatus.connected`; the model requires
current-generation, fresh route/DNS/core/probe receipts. That receipt path is not
yet attached to a running engine. Failures invalidate the generation, including
extension Action Required receipts; late successes cannot revive that attempt.
A future integration must also withdraw
Protected on receipt expiry, revocation, invalid policy, path loss and core exit.

## Current contracts were inspected, not replaced

Started from origin/main at
[`ed6b267608e21a97d2b7d12c7700d6e121679c52`](https://github.com/raydocs/tono/commit/ed6b267608e21a97d2b7d12c7700d6e121679c52).
Reviewed open [shared #202](https://github.com/raydocs/tono/pull/202),
[macOS #199](https://github.com/raydocs/tono/pull/199) and
[Windows #203](https://github.com/raydocs/tono/pull/203) without modifying their branches.

- Brand host is `https://ninx.app`; account API remains the existing
  `https://api.afk.ccwu.cc/api/v1`. HTTPS origin is allowlisted, redirects refused,
  sessions ephemeral, response size/time bounded. There is no debug host override.
- `POST auth/email/start`: `email`, `deviceName`, `installationId` →
  `challengeId`, `expiresIn`; `POST auth/email/verify`: `challengeId`, `code` →
  existing wrapped/unwrapped auth. Enrollment keys are not retained. The backend
  may rotate the least-recently-active device when full; the login screen says so.
  A `DEVICE_LIMIT` error needs another signed-in device; no unauthenticated
  device-list/removal API is invented. Verification consumes the challenge, so
  after that error request a **new** code.
- `POST auth/refresh` rotates tokens. A failed Keychain write retains the new
  pair in memory and requires persistence before further authenticated requests.
  Refresh is single-flight; only GETs replay after a 401. POST/DELETE never replay
  automatically. Local sign-out removes the stored session after pausing; it
  does not remotely revoke the installation or other sessions.
  Terminal `sessionExpired` (including `401 INVALID_REFRESH_TOKEN`) clears user,
  devices, challenge, selected location, diagnostics and credentials, invalidates
  protection receipts, deletes the Keychain session and returns navigation to
  sign-in. Offline/transport errors and 5xx preserve the session. If Keychain
  deletion fails, memory/navigation still clear and a storage warning is shown;
  this process cannot restore that session. After unlock/relaunch, any remaining
  stored session must pass `/me` again and a terminal response retries deletion.
  This does not claim system-level traffic blocking or revoke remote sessions.
- `GET devices`, `DELETE devices/{id}` use current server device limits. Self
  removal is rejected; old-device removal needs explicit confirmation. The row,
  confirmation and removal accessibility label include the full server device ID
  to distinguish duplicate names even if their ID prefixes collide. IDs are
  account metadata displayed locally, not uploaded as diagnostic events.
- `GET exit-catalog` still returns `{revision,yaml,sha256,routing}` with
  `homeProxy`, `defaultProxy`, `homeSocks5`. HY2 is requested via `X-Tono-Accept`.
  YAML is an opaque **Tono-issued** value, not user-imported config. The digest
  verifier refuses to produce a node/runtime without the missing complete raw
  routing + catalog admission adapter. Do not enable it by dropping unknown keys.
  Both catalog and policy `sha256` are **unpadded base64url**, from Worker
  `src/crypto.ts`, not lowercase hex. Signatures use standard base64 instead.
- `GET traffic-policy` uses the existing Ed25519 public key and exact
  `tono-traffic-policy-v1\n` signed-byte prefix. Unsigned/bad-signature policies
  refuse; desktop DIRECT/process semantics and unknown policy fields refuse.
  This is deliberately stricter than desktop unsigned allowlists. No admitted
  policy is persisted/used by a tunnel yet. Account-scoped rollback/equivocation
  protection and signed policy freshness must precede future activation.
- Shared #202's Rust API takes **already admitted desktop inputs** and exposes
  no Swift/iOS FFI. This draft neither copies its JSON schema into a fake API nor
  claims desktop interface-bound DIRECT/process leases work on iOS.

## The pinned build identity cannot currently be embedded on iOS

`Configuration/core-requirement.json` and `SingBoxIdentity` retain upstream
**v1.15.0-alpha.3**, commit
[`93fff5954390367dd456cad3cbd79be54f8b941f`](https://github.com/SagerNet/sing-box/commit/93fff5954390367dd456cad3cbd79be54f8b941f),
**Go1.27.1**, **CGO=0**, exactly
`with_gvisor,with_quic,with_utls,with_clash_api`, unchanged module hashes and no
patches. There is **no iOS artifact hash or ABI**, and adding an arbitrary
XCFramework beside the app cannot bypass the hard admission refusal.

The current Tono Darwin artifact is a macOS CLI, not an iOS library. iOS cannot
spawn it. Upstream's actual Apple integration binds `experimental/libbox` into
`Libbox.xcframework` using generated Objective-C/C glue and cgo; its builder also
uses additional tags including iOS low-memory handling. Sources:
[builder](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/cmd/internal/build_libbox/main.go),
[Apple FFI targets](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/libbox/ffi.json),
[platform interface](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/libbox/platform.go),
[TUN interface](https://github.com/SagerNet/sing-box/blob/93fff5954390367dd456cad3cbd79be54f8b941f/experimental/libbox/tun.go).

**Owner decision required:** approve a distinct Apple embedding build identity
and its cgo/binding/tag/toolchain provenance, or provide an audited embedding ABI
that actually meets the unchanged constraints. No such change is made here.
Do not run upstream's broad default build and call it the pinned Tono build.
Pin the binding generator, target SDK/slices, module graph, toolchain modifications
(including any upstream iOS CPU patch), output/manifest hashes and code signature
separately. Review sing-box licensing and Apple distribution terms before linkage.

The future platform adapter must supply documented packet-flow/utun integration,
settings/DNS ownership, socket routing outside the tunnel, path/interface updates,
low-memory lifecycle and a health receipt. Do not use private KVC to obtain a
file descriptor as an unreviewed shortcut. Extension credentials need a separately
designed, least-privilege Keychain grant; app refresh tokens are **not** shared.
Only non-secret preferences are in `group.com.ninx.tono` today. Extension launch
while locked/before first unlock must refuse if credentials are unavailable.

HY2 and HY2→home are explicit unavailable families: Tono's leaf-certificate
**DER** SHA256 pin is not sing-box's **SPKI** pin. Dropping the pin, disabling
verification, using a same-key substitute or treating PEM roots as equivalent is
forbidden. Reality and Reality→home also remain unavailable until the core and
catalog/platform adapters exist. Ordered backups and direct-entry fallback need
an authoritative cloud grant; `homeSocks5` alone is not such a grant.

## Apple traffic coverage is explicit, not an all-packets guarantee

The **uninstalled** profile factory sets `includeAllNetworks=true`,
`excludeLocalNetworks=false`, `excludeAPNs=false` and
`excludeCellularServices=false`: no optional local/APNs/cellular-service bypass.
Apple defaults the latter two exclusions to true; this draft overrides them.
`enforceRoutes=false` is deliberate: Apple applies that route-scoping mechanism
only when `includeAllNetworks=false`, so enabling both is not extra protection.

Apple still excludes network control traffic (such as DHCP), captive portal
negotiation, cellular-only services (such as VoLTE), and companion-device
communication. Tono cannot promise that every device packet enters the tunnel.
Before profile activation, qualify APNs delivery, Wi-Fi Calling/MMS/voicemail,
captivity, IPv4/IPv6 and Wi-Fi/cellular handover on a dedicated device; document
which unavoidable exclusions are observable. If an account's policy requires
coverage Apple cannot provide, refuse admission rather than silently exclude it.
This factory change installs nothing and is not Network Extension evidence.

Apple references: [includeAllNetworks](https://developer.apple.com/documentation/networkextension/nevpnprotocol/includeallnetworks),
[excludeAPNs](https://developer.apple.com/documentation/networkextension/nevpnprotocol/excludeapns),
[excludeCellularServices](https://developer.apple.com/documentation/networkextension/nevpnprotocol/excludecellularservices),
[enforceRoutes](https://developer.apple.com/documentation/networkextension/nevpnprotocol/enforceroutes).

## Diagnostics and production policy

Comprehensive means all **allowlisted** app events, not every byte available on
the device. The in-memory buffer retains at most 128 events; it is not backed up.
Fields are closed event/state/error enums, minute-rounded observation time and
5-second duration buckets capped at 300 seconds. No free-form error/body/log,
URL, domain, destination, selected node, email, verification code, token, UUID,
private key, SOCKS password, packet/content or device name can enter the event API.
HTTP authentication still necessarily uses the bearer token in its header, never
in the diagnostic payload. Reports are account-linked server-side; the privacy
manifest says linked, not anonymous.

Uploads use the existing `/telemetry/windows` schema with `platform: ios`, at
most once per 20 minutes of foreground activity, or a deliberate Send action in
technical diagnostics. No anonymous fallback, `/diagnostics/logs`, background
task registration or per-packet logging. A receipt is required before clearing
the buffer; stale/clock-skewed events are dropped rather than re-timestamped.
Toggle changes clear pending history. Off disables collection/upload. Minimal
filters successful events at collection, omits duration fields, and sends nothing
unless at least one retained failure falls within the last six hours. Empty or
stale-only buffers cannot send metadata-only windows. The picker uses an explicit
nonrecursive normalized/persisted setter, not self-assignment in an observation
hook. A `TONO_DISTRIBUTION=production`
build caps even a stored Comprehensive preference at Minimal; unknown/missing
distribution also defaults to Minimal. The shipped project currently explicitly
uses `testflight`. App Store privacy declarations need owner review before upload.

### Ops timeline integration remains deferred

Validator acceptance is **not** timeline/status compatibility. Current
`services/control-plane/src/ops/flatten.ts` only flattens `FLATTEN_KINDS`, which
exclude `stateChanged`, `admissionRefused`, `accountRequest`, `pauseRequested`.
`ops/customers-status.ts` treats only `uiState=connected` as connected and counts
`connectFail`, not generic account errors. Current iOS windows can be retained
but must not be used to qualify connection history, failure rates or live status.

Before runtime/ops qualification, add operation-specific iOS events and test
these mappings together with the ops owners (no backend changes in this PR):

| iOS event context | Required ops mapping / constraint |
|---|---|
| Actual start attempt (`stateChanged` to Connecting today) | `connectBegin` with an attempt identity; not every state change |
| Start admission/core failure | `connectFail` for that attempt; current `admissionRefused` also includes account/upload errors and **cannot** be globally renamed |
| Account/catalog sync failure | `syncFail` if its semantics match; never inflate connection-failure counts |
| Authenticated, fresh Protected receipt | `connectOk` and `uiState=connected` only after runtime qualification; never from preview or NEVPNStatus alone |
| Successful disable/save/stop confirmation | `disconnectOk`; `pauseRequested` alone is not stop evidence |

Acceptance must prove an admitted failure window creates a `connection_events`
row/timeline entry and updates failure status, while an account failure does not;
test state transitions and duplicate-window ingestion too. The present fixture
checker exercises only intake validation, deliberately not these unimplemented
contracts. This is a blocker for claiming ops compatibility, not permission to
activate the absent core or publish TestFlight.

## Executable Orb checks

From the repository root:

```sh
python3 apps/ios/tools/project.py --check
PYTHONDONTWRITEBYTECODE=1 python3 apps/ios/tools/test_static.py
node apps/ios/tools/check-cloud-contract.mjs
git diff --check
```

The first two require Python 3.10+ only. The Node check uses the repository's
already installed control-plane `esbuild` dependency to execute the actual
Worker telemetry validator and SHA-256 function, with no server, account or network request. If absent,
prepare that workspace's locked dependencies using its standard `npm ci` workflow.
The telemetry fixture is handwritten. `Tests/Fixtures/admission.json` is produced
by the Worker function using `node apps/ios/tools/check-cloud-contract.mjs
--write-digest-fixtures` (one command); ordinary runs compare without rewriting.
Swift tests load the same bundled fixture. There is no production-key-signed
positive policy fixture: the tests check digest compatibility and unsigned/bad
signature rejection, without adding a trust-key override. These Orb checks are
**not** Swift emitted-byte, signature-success, native or ops-timeline evidence.
The project generator is deterministic; run it without `--check` only after
adding/removing native sources. No XcodeGen, remote packages or script build phases.

Native `TonoTests` cover generation/pause, incomplete/stale protection receipts,
ordered backup/home-required/manual fallback boundaries, strict On Demand profile,
core refusal, Worker digest/tamper/signature boundaries, malformed home credentials,
auth decoding, duplicate device removal labels, diagnostic minimization and wire
shaping. `AppModelTests` adds nonrecursive opt-out persistence/clearing, restored
session invalid refresh versus offline/503, deletion failure without memory revival,
and Minimal pause/stale-only zero-request versus recent-failure upload. It uses
the real CloudClient with URLProtocol interception, an in-memory vault and a stub
tunnel; it never contacts the API, Keychain or system VPN manager. `TonoUITests` checks labelled preview and
location interaction, retaining a screenshot. These tests were **not executed**
in the Orb; neither Swift nor Xcode nor an Apple Simulator is installed. No
native screenshot/performance/Network Extension/TestFlight proof exists. A
generated design reference is not a rendered-app screenshot.

## Exact Mac Studio / Xcode verification

Use the Mac Studio acceptance machine, **not a MacBook fallback**. Use a fresh
checkout or preserve all existing work. Substitute the exact PR head SHA supplied
with the handoff; never treat a later branch head as the tested revision.

```sh
git fetch origin feat/ios-native-companion
git switch --detach <exact-pr-head-sha>
git rev-parse HEAD
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -showsdks
python3 apps/ios/tools/project.py --check
plutil -lint apps/ios/Tono.xcodeproj/project.pbxproj
xcodebuild -list -project apps/ios/Tono.xcodeproj
xcrun simctl list devices available
```

Require **Xcode 26+ with the iOS 26 SDK**. Choose a disposable iOS 26+ iPhone
Simulator UUID from the last command; do not use one holding a real Tono account.
Record SDK/runtime versions and the UUID with the receipt. Build/test once:

```sh
export SIMULATOR_ID='<disposable-ios26-simulator-uuid>'
export EVIDENCE="$HOME/tono-ios-evidence/$(git rev-parse HEAD)"
mkdir -p "$EVIDENCE"
xcodebuild -project apps/ios/Tono.xcodeproj -scheme Tono \
  -configuration Debug -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath "$EVIDENCE/DerivedData" -resultBundlePath "$EVIDENCE/Tests.xcresult" \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project apps/ios/Tono.xcodeproj -scheme Tono \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$EVIDENCE/ReleaseDerivedData" CODE_SIGNING_ALLOWED=NO build
```

Both test targets must execute a nonzero count, not skip. If the same blocker
survives two focused corrections, retain evidence and stop rather than cycling
full builds. Simulator success still does not prove NetworkExtension or On Demand.
There are currently **21 XCTest methods and one UI test**. Confirm all four
AppModel regressions, both Worker digest tests and the late-failure receipt test
appear in the xcresult; a source scan is not their execution. Leave
`TONO_PREVIEW_STATE` unset for unit tests (the UI test sets its own launch value).

For visual review, open `apps/ios/Tono.xcodeproj`, scheme Tono → Run → Arguments,
set `TONO_PREVIEW_STATE` to `ready`, `connecting`, `protected`, `recovering`,
`paused` or `actionRequired` (DEBUG only). In-app preview switching also exists.
Every mock home must say **Interface preview · no VPN**; Connect/Pause and remote
operations are disabled. Real login is available when the variable is removed.
Inspect light/dark, accessibility Dynamic Type, VoiceOver focus/actions, Reduce
Motion, Reduce Transparency, landscape, smallest supported iPhone and iPad. Review
Home → Location → pinned preview choice, settings → Devices and hidden diagnostics
(long-press version; VoiceOver custom action). Capture and **inspect** screenshots:

```sh
xcrun simctl io "$SIMULATOR_ID" screenshot "$EVIDENCE/home.png"
```

Use Instruments Animation Hitches and Energy Log on a device for motion; verify
no render loop after locking, app switcher, another page or background; low power
must freeze particles. Resume must not reset particle phase. DEBUG preview is
visual-only and never evidence of encrypted traffic.

## Signing, device and TestFlight acceptance — not executed

1. Owner registers/verifies `com.ninx.tono`, `com.ninx.tono.PacketTunnel` and
   `group.com.ninx.tono` in the same Apple Developer team. Enable the Packet
   Tunnel capability and matching App Group for both IDs. Use owner-provided
   profiles/team; no provisioning credentials belong in this repository. Do not
   add `-allowProvisioningUpdates` or silently change IDs to make signing pass.
2. On a dedicated iOS 26+ device, select that team in both Xcode targets and Run.
   With an explicitly approved test account exercise email delivery, wrong/expired
   code, login at the device allowance, device rotation/list/removal, relaunch,
   token expiry, offline recovery, Keychain failure, local sign-out and revocation.
   In particular: Comprehensive → Off must clear events and survive relaunch;
   Minimal pause/Send must make no telemetry request, whereas a recent failed
   Connect/Send must send one redacted failure. After session revocation/invalid
   refresh, expect sign-in and no old devices/location/history; offline/503 must
   not sign out. With duplicate device names, inspect wrapping at accessibility
   Dynamic Type and VoiceOver removal labels/confirmation against each full ID;
   cancel before deletion unless that exact test-device removal is authorized.
   Current expected Connect result is **Action Required**, no installed reconnect
   loop and no claim that traffic is blocked. Keep existing VPNs untouched.
3. **After**, not before, resolving the core/policy gates: inspect signed app and
   extension entitlements; verify embedded artifact provenance; test On Demand
   with the app closed, Wi-Fi↔cellular, sleep/wake, reboot/unlock, extension crash,
   DNS and IPv6 leak probes, entitlement expiry and remote device revocation.
   Confirm pause persists across app kill/reboot and does not reconnect; resume
   must clear pause only after a successful protected start. Test ordered home
   failure, retained backup, manual pin failure and required-home rejection.
   Validate HY2 DER pin with same-public-key/different-leaf negative controls.
4. Supply/review the app icon, privacy/support URLs, export-compliance answers,
   license notices and App Store Connect record. Archive on Mac Studio with the
   approved identity only after native gates pass. Validate the archive in Xcode
   Organizer, inspect the privacy report and embedded extension. Upload to
   **TestFlight only with separate owner publication approval**; internal testing
   first, Beta App Review as required. This PR authorizes none of these actions.
5. Before later production, build with `TONO_DISTRIBUTION=production`, prove that
   upgrading a Comprehensive preference yields Minimal and that Off stays Off.
   Review actual redacted payloads privately. No customer data in public PR logs.

No workflow was added: current path filters do not run iOS tests. Native CI is
**not run**, not green/pending by inference. A future authorized CI addition
belongs on GitHub-hosted `macos-26`, without persistent-machine or signing access
for public PRs. Do not dispatch the macOS desktop workflow as iOS evidence.
