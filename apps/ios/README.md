# Tono for iOS — native integration draft

iOS/iPadOS **26+**, SwiftUI, native Liquid Glass, `ninx.app`. This is G1/G2
new-platform integration work, **not a qualified VPN or TestFlight release**.
Implementation stays in `apps/ios`; a separate hosted-CI workflow is prepared.
No existing platform, backend, signing account,
deployment, release line or customer update feed is changed.

## September 15 runtime continuation: source-tested, still blocked before start

Verified current `origin/main` and PR #204's requested starting head
[`200c8ac`](https://github.com/raydocs/tono/commit/200c8ac994431fff34a1c6cbfc7bd6feb5d849e0),
and inspected shared #202 at
[`c1bf504`](https://github.com/raydocs/tono/commit/c1bf5049b25d9a27bd35afac2d8a58f9dc16f115).
Main was already an ancestor. The shared contract has **not** approved a mobile
ABI, extra tags, linker flags, patches or a replacement CGO identity.

`Runtime/` now contains a real Go admission/compiler package, staged into a clean
pinned sing-box module for source tests. It is **not linked to the Swift app**:

- Complete catalog/policy response bytes; bounded decoding; exact JSON keys,
  required fields, duplicate-key/alias rejection; Worker base64url digests and
  production Ed25519 signature context. Tests use a private test-only signer;
  the exported compiler cannot replace the production trust key.
- Public IPv4 endpoint, UUID, Reality key/short-ID, TLS and name admission;
  same-node HY2 identity and mandatory DER-pin validation, even when unselected.
  Selected HY2 refuses with `TONO_IOS_DER_BACKEND_UNAVAILABLE`; unselected HY2
  names are explicitly returned as unavailable. No SPKI substitution.
- Manual pin wins over the cloud default; a missing pin/default refuses rather
  than selecting a different node. Cloud YAML DNS/rules never become runtime.
- Actual sing-box JSON emission and parser/constructor tests: proxied DoH,
  inbound-scoped fake IPv4, empty AAAA, dual-family TUN capture intent, IPv6
  reject, DNS interception before generic UDP rejection. No `stack`, controller,
  local DNS fallback, direct outbound or persistent core cache.
- Caller-supplied account/device-scoped revision watermarks reject rollback and
  same-revision equivocation, including changes to otherwise-unhashed routing.
  These values are **not yet persisted or integrated with extension credentials**.
  A revision is not a freshness lease; the existing policy has no signed expiry.
- Home/DIRECT/process rules, new routing fields and unsupported fingerprints
  refuse explicitly. Ordered home fallback still lacks a cloud grant; endpoint
  presence alone does not authorize it. No home support is claimed.

The Swift receipt model now expires Protected after ten seconds without fresh
health (and on backward clock movement), rejects replayed observations, and
invalidates the failed generation before any late success. The foreground app
checks expiry immediately on re-entry and once per second while actually
Protected; previews do not run the check. This is state-machine logic, **not**
proof of a running extension, packet blocking or automatic crash recovery.

### Exact mobile build blockers, verified in source and by a real link attempt

1. **CGO/ABI:** pinned gomobile builds Apple slices with `-buildmode=c-archive`
   and Objective-C/cgo bindings. Desktop CGO=0/no-patch identity does not describe
   such a framework. `core-requirement.json` remains unchanged, with no approved
   iOS hash or ABI. No stock framework is accepted by placing it in the bundle.
2. **Linker:** Go 1.27.1 / CGO=0 / the four tags can compile the Linux libbox
   archive, but linking actual `libbox.CheckConfig` fails:
   `experimental/libbox/internal/oomprofile: invalid reference to runtime/pprof.parseProcSelfMaps`.
   The upstream FFI manifest uses `-checklinkname=0`; adding it is a new build
   identity, not a harmless retry. The failure is retained, not hidden by flags.
3. **Public packet flow:** `libbox.PlatformInterface.OpenTun` returns an FD;
   `service.go` queries its interface name and duplicates it. More importantly,
   pinned sing-tun `stack_go_io_darwin.go` requires `*NativeTun`, detaches its
   runtime poller and accesses the raw descriptor. A custom `io.ReadWriter` or
   socketpair pump cannot satisfy the default stack merely by changing libbox.
   Upstream's private KVC/FD scan is not adopted. A public NEPacketTunnelFlow path
   requires reviewed changes in **both** libbox and sing-tun, or explicit approval
   of the upstream descriptor integration. No fake packet adapter is installed.
4. **DER:** stock HY2 TLS pins SHA256 of SPKI, not the catalog's leaf DER.
   A reviewed patch must reach the actual QUIC TLS backend and prove same-key,
   different-leaf rejection, name/time semantics and every admitted TLS engine.
   The compiler cannot invent a DER JSON option that stock bytes do not read.

Sources are the exact pinned `experimental/libbox/{platform,service}.go`,
`experimental/libbox/internal/oomprofile/linkname.go`,
`experimental/libbox/ffi.json`, `common/tls/std_client.go`,
gomobile `v0.1.12` `cmd/gomobile/bind_iosapp.go`, and sing-tun
`v0.9.4-0.20260912075549-869f0a4d76af` `stack_go_io_darwin.go`.
The upstream Makefile installs gomobile v0.1.13, while go.mod pins v0.1.12;
the FFI version command also uses `@latest`. Neither is a reproducible Tono
build recipe without reconciliation. Do not run those defaults as approved bytes.

### Reproduce the Orb checks without an Apple SDK

Supply a clean checkout of the pinned upstream commit and an existing Go1.27.1
Linux/amd64 toolchain. Populate that checkout's checksum-locked cache once with
`GOTOOLCHAIN=local GOWORK=off GOENV=off go mod download`. Then:

```sh
python3 apps/ios/tools/check-runtime.py \
  --source /path/to/clean/pinned-sing-box --go /path/to/go1.27.1/bin/go \
  --receipt /new/path/runtime-receipt.json --probe-libbox
```

This checks commit/module/toolchain identity, stages only the iOS Go sources,
compiles with module downloads disabled, runs five Go regressions against the
actual core parser, builds libbox's Linux archive twice and records hashes.
`--probe-libbox` additionally links actual libbox and **exits 2 on link failure**
after writing successful source evidence plus the linker diagnostic. Omitting
it tests source/parser only, not libbox linking. No upstream source is patched.
The approved pin remains unchanged. The downloaded Orb toolchain archive was
SHA256 `63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`.
Native Xcode/SDK, NEPacketTunnelFlow, socket escape, App Group credential IPC,
On Demand activation, signed resources, memory/energy and device acceptance
remain **not executed / not implemented**, not inferred from these tests.

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
Foreground receipt expiry is implemented; a future integration must also attach
revocation, invalid policy, path loss and core-exit signals to this state machine.

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
  a successfully written atomic, non-secret
  `Application Support/Account/logout-pending` marker prevents subsequent launches
  from restoring it, even if `/me` would still accept the token.
  This app-private marker is not in Keychain or the App
  Group and contains no account identity or credentials. Restoration retries
  deletion before reading credentials; the signed-out screen also offers
  **Retry sign-out cleanup**. Only successful Keychain deletion permits marker
  removal and new email authentication. Cleanup reuses an existing marker without
  rewriting it; read/clear failures keep recovery reachable and block restoration.
  If recording the marker itself fails during explicit sign-out, logout is not
  reported complete: the account remains visible with a storage error and Sign
  out stays reachable. The already completed pause remains in force. Terminal
  auth loss instead invalidates the epoch, cancels refresh and clears credentials
  **before any storage operation**, then attempts deletion even if marker storage
  fails. A non-secret process-wide fence keyed by marker path blocks fresh clients
  in that process until cleanup succeeds. Marker errors remain visible even when
  fallback deletion succeeds. **If both marker persistence and Keychain deletion
  fail, a full process restart cannot be guaranteed safe**: no durable change has
  succeeded. The UI says cleanup is incomplete and asks for retry before closing;
  it never promises durable logout in that state. A process fence is not evidence
  of protection across process death or app-container deletion.
  Cold-start transient `/me` failure exposes **Retry saved sign-in** rather than
  ordinary email login. Retry keeps the retained (or newly rotated in-memory)
  token pair; `user` stays nil until `/me` succeeds. No cached identity is treated
  as authorized, no background retry loop or new email authentication is required.
  Permanent saved-session JSON decoding failure or Keychain `errSecDecode` instead
  exposes **Forget saved sign-in**. Forget uses the same write-ahead cleanup path;
  failed deletion transitions to cleanup retry, then ordinary email login only
  after cleanup. Transient Keychain unavailability remains retryable, not corruption.
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
explicit valid-session logout with failed deletion across client/model recreation
and eventual cleanup, cold-start offline → 503 → successful `/me` retry using the
same token without new authentication, terminal marker-write failure with a
process fence across client/store recreation and fallback deletion, durable-marker
reuse through read/clear errors, malformed-session forget/recreation/recovery,
and Minimal pause/stale-only zero-request versus recent-failure upload. It uses
the real CloudClient with URLProtocol interception, an in-memory vault, a real
temporary logout-marker directory (with injectable marker-operation failures)
and a stub tunnel; it never contacts the API, Keychain or system VPN manager.
`TonoUITests` checks labelled preview/location interaction and the reachable
malformed-session → Forget → failed deletion → Retry cleanup → email-login flow.
The latter uses `TONO_ACCOUNT_FIXTURE=malformed-session`, **DEBUG-only**, with
isolated dependencies and all outbound requests rejected, not the preview model.
These tests were **not executed**
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
There are currently **27 XCTest methods and two UI tests**. Confirm all nine
AppModel regressions, both Worker digest tests and the late-failure receipt test
appear in the xcresult; a source scan is not their execution. Leave
`TONO_PREVIEW_STATE` and `TONO_ACCOUNT_FIXTURE` unset for unit tests (UI tests set
their own launch values). In particular, require these newly added tests:

- `AppModelTests/testTerminalMarkerFailureFencesRecreationAndStillAttemptsCredentialDeletion`
- `AppModelTests/testDurableCleanupRetryNeverRewritesIntentAndRetainsItThroughReadAndClearFailures`
- `AppModelTests/testMalformedColdStartCanForgetSessionThroughPendingCleanupAndRecreation`
- `CompanionUITests/testMalformedSessionExposesForgetThenCleanupRetryThenEmailLogin`

For manual recovery-screen inspection in DEBUG, set only
`TONO_ACCOUNT_FIXTURE=malformed-session`. Dismiss the corruption alert, select
**Forget saved sign-in**, dismiss the injected deletion-error alert, then select
**Retry sign-out cleanup**. Email login must become reachable, Home must never
appear, and the fixture must make no real account/Keychain/VPN changes. Inspect
VoiceOver focus and accessibility Dynamic Type on both recovery states. Unset the
fixture variable before any real-account acceptance; Release ignores it.

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
   not sign out. Exercise a cold launch offline, dismiss the error, restore
   connectivity, then select **Retry saved sign-in**: no Home/cached email before
   `/me` succeeds and no verification code needed. The native mocked regressions
   inject failed Keychain deletion, retain valid credentials and recreate the
   client/model against the same on-disk marker. Run them by their exact names:
   `AppModelTests/testExplicitLogoutSurvivesClientRecreationUntilDeletionCompletes`
   and `AppModelTests/testColdStartRetriesTransientRestoreWithoutNewAuthentication`.
   Inspect the pending-cleanup retry screen with VoiceOver/Dynamic Type; after
   cleanup succeeds it must return to email login, never the old account.
   With duplicate device names, inspect wrapping at accessibility
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

A separate `ios-ci.yml` is prepared for GitHub-hosted `macos-26` Simulator
Debug unit/UI tests and Release compilation, plus `ubuntu-24.04` portable Go
compiler tests. It has read-only repository permissions, no signing or persistent
device access, no runtime/SDK downloads and no release output. Check the PR's
delivery status: a workflow-permission rejection can leave this commit local.
Native CI is **not run** until an actual uploaded workflow run proves otherwise;
neither the workflow source nor the Linux archive qualifies an Apple build.
Do not dispatch the macOS desktop workflow as iOS evidence.
