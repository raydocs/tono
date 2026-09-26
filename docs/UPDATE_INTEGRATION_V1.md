# G3: native update transaction integration

This is the implementation contract for #26, following the shared value model
in [UPDATE_PROTOCOL_V1.md](UPDATE_PROTOCOL_V1.md). It is not acceptance evidence.
The owner requested real macOS/Windows integration and permits manually replacing
legacy clients. Source work does not authorize signing, deployment, feed changes
or device installation. Product version remains 0.0.74 during development.

## Settled implementation choices

- One canonical, detached manifest binds both native packages from the **same
  exact Git source SHA**, with one signed `releaseSequence`. The manifest is
  generated after final signing/stapling/packaging; embedding it in the packages
  it hashes would be circular.
- Tono owns macOS full-bundle installation. Sparkle's public postpone callback
  cannot attest its consumed archive or precede every mutation; do not maintain
  a private Sparkle hook/fork or trust a second download as its input.
- Windows reuses the native replacement executor, but entry must consume the
  Service-owned attempt before **any** live or repair-resource mutation. Opaque
  Tauri updater installation and the legacy all-user journal scan are not v1
  authorization.
- Native adapters reuse existing signing identities and locked verification
  libraries. Do not rotate keys, invent certificates, or enable unsigned input.
  The existing first-Windows-release policy permits absent Authenticode; it
  does not permit an unsigned update manifest or unverified execution identity.

## Detached transport

Both apps discover bounded canonical manifest bytes at
`https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json`. This new endpoint
is not published by this source change. Discovery is untrusted until signature
verification. Missing or mismatched metadata is not "up to date" and must not
fall back to the legacy installer.

Compute SHA-256 over the exact manifest bytes and download immutable files from
`https://releases.afk.ccwu.cc/desktop/v1/<manifest-sha256>/`:

| File | Contents |
|---|---|
| `manifest.json` | Exact canonical bytes shared by both platforms |
| `manifest.macos-arm64.sig` | Base64 Ed25519 signature using the existing macOS update key, over those exact bytes |
| `manifest.windows-x86_64.sig` | Existing Tauri/minisign base64 signature box over those exact bytes |
| `package.macos-arm64.zip` | Complete final signed/stapled Tono.app archive |
| `package.windows-x86_64.exe` | Complete final Windows NSIS package |

Signature files are at most 4,096 bytes. Packages have the exact size/digest in
the signed target. Fixed filenames and a hex digest avoid accepting publisher
paths as filesystem paths. A discovery/signature race rejects rather than
combining releases. Never accept a key supplied alongside an offer. Mac trust
is compiled into the Helper; Windows trust is compiled from the existing
`TONO_UPDATER_PUBLIC_KEY` release input, not read from mutable App configuration.
No configured Windows key means no update admission.

The release-host Worker allows only these exact R2 keys under `desktop/v1/`.
The `latest/manifest.json` discovery response is `no-store`, including a missing
object response; digest-addressed objects are immutable. Metadata ignores Range
requests and returns exact whole bytes; packages retain GET/HEAD range support.
This is a read-only route, not an upload API or a deployed/published offer.

## Privileged transaction, not an App journal

1. Authenticate the live requesting App's native process incarnation and
   registered installation. Reserve a unique attempt and monotonic generation
   durably before update-specific ownership/network changes.
2. Copy package input into a private root/SYSTEM-owned directory, rejecting
   reparse/symlink traversal and size changes. Verify the **private copy**,
   manifest signature, release sequence, expected native identity and target
   components before quiescing. Apps can download but cannot choose trusted
   storage paths, set observed phases or supply protection proofs.
3. The existing privileged runtime coordinator quiesces Core/TUN, restores and
   reads back DNS/proxy state, retains PF/WFP when required, and only then
   persists `installationAuthorized`. Unknown protection refuses admission.
4. The executor consumes admission durably under the same native serialization
   boundary before mutation. Record consumed/replaced/rollback/uncertain
   execution facts separately from successful proof phases. Lost acknowledgement
   is a query/reconciliation case, never permission to execute twice. Persist
   the consumed sequence high-water mark before mutation; rollback cannot lower it.
5. Replace from private staging, retaining old App/Core/Helper-or-Service and
   repair resources until final commit. An executor/recovery entry independent
   of the replaced daemon must survive its replacement and restart. Reconcile
   pending installation before normal desired-state restoration on reboot.
6. Authenticate the new App at the same registered location, verify actual
   components and native process identity, allocate/retain one successor
   generation, then re-establish and observe the captured recovery obligation.
   Revalidate live identity/protection before durable commit. Only committed
   transactions may release rollback resources; consumed evidence stays.

Every disk acknowledgement is after the actual atomic durable write. Existing
root-owned/Service-owned locks and storage conventions remain authoritative;
do not add an App-only latch as the security boundary. Corrupt, expired or
uncertain records retain evidence and protection and block a new attempt.

Pending transactions gate competing connect/watchdog, ordinary helper upgrade,
repair/uninstall and quit cleanup. Cancellation before consumption and explicit
Disconnect are different operations: neither may fabricate recovery, relabel
the original obligation or erase a consumed attempt. A verified user-requested
protection release requires its own existing privileged cleanup proof.

Legacy App journals remain readable diagnostics only. Manual bootstrap must
first use normal verified Disconnect; it is not a protected legacy migration.
Adoption of a newer on-disk version is not evidence that this transaction
installed it.

## Delivery and evidence

Native owners implement their adapters, active App caller and production-bound
failure regressions; the integration owner implements paired packaging and
combines exact-source evidence. Shared manifest/receipt sources and fixtures
have one owner. The two native implementations must consume those models,
not create similar local contracts.

Required automated evidence includes private-stage input verification,
pre-mutation consumption, duplicate request/lost acknowledgement, failed durable
writes, interrupted replacement/restart, retained rollback and successor/recovery
binding. Tests must call production boundaries with substituted I/O where needed;
pure phase replay is not proof of actual installation or PF/WFP ownership.

Run Swift/Rust on the existing hosted native lanes. Do not add public-PR signing
privileges, persistent runners, test-key environment bypasses or a second
installation path for tests. New UI states need real rendered review. A hosted
unit test or component capture does not replace authorized installed Mac and
Windows 11 success/failure, DNS and packet-level acceptance. #26/G3 remains open
until that evidence exists.

## Paired build and offline publisher commands

`desktop-update-candidate.yml` is an operator-dispatched, unsigned workflow. It
calls the existing macOS/Windows native build lanes at the caller SHA with the
same validated sequence, measures components extracted from the actual archive
and NSIS package, and emits `manifest.unsigned.json` beside both packages. It
does not have signing secrets, execute installers or publish anything. An
unsigned macOS CI archive remains unusable at the production Helper trust
boundary; do not sign that manifest as a shortcut around Developer ID/notarization.

For a real pair, both native packages must first be built from the same approved
source with the same sequence through the existing signing/qualification gates.
Set `TONO_UPDATE_RELEASE_SEQUENCE` for both macOS sealed build metadata and the
Windows compiled floor. The paired candidate workflow supplies it from its one
input; the existing gated release workflows also accept the optional
`update_release_sequence` input without changing their branch/signing gates.
Omitting it produces no v1 installed floor, so automatic admission refuses rather
than guessing from the app version. Keep the source appVersion in sync; labels
are not used to compare update order.

The offline publisher has no private-key, network, upload or feed operation:

```sh
# Run on each native build after final package creation, using actual unpacked
# App/Core/Helper-or-Service files from that package (not a previous build).
node tooling/scripts/desktop-update-v1.mjs measure \
  --version "$VERSION" --source "$SOURCE_SHA" --sequence "$SEQUENCE" \
  --target macos-arm64 --artifact "$MAC_ZIP" \
  --app "$MAC_APP/Contents/MacOS/Tono" \
  --core "$MAC_APP/Contents/Resources/sing-box" \
  --privileged "$MAC_APP/Contents/Resources/tono-core-helper" \
  --output update-target.macos-arm64.json

node tooling/scripts/desktop-update-v1.mjs measure \
  --version "$VERSION" --source "$SOURCE_SHA" --sequence "$SEQUENCE" \
  --target windows-x86_64 --artifact "$WIN_EXE" \
  --app "$UNPACKED_WIN_APP" --core "$UNPACKED_WIN_CORE" \
  --privileged "$UNPACKED_WIN_SERVICE" --output update-target.windows-x86_64.json

node tooling/scripts/desktop-update-v1.mjs assemble \
  --macos update-target.macos-arm64.json --windows update-target.windows-x86_64.json \
  --source "$SOURCE_SHA" --sequence "$SEQUENCE" --release-id "$RELEASE_ID" \
  --output manifest.json
```

Signing is a separate authorized operation. The pinned Sparkle 2.9.6 `sign_update`
tool can sign the **JSON file bytes** with the existing macOS update key; it is
only a signing utility here, never the installer. The release workflow downloads
the independently checksum-pinned binary archive, not the removed App SwiftPM
dependency, and verifies the tool before using it. Tauri's existing `signer sign`
can sign the same JSON using its private-key-file option. Keep private keys and
passwords out of command arguments/logs; use the existing isolated signing jobs.
Retain the raw Ed25519 Base64 result as `manifest.macos-arm64.sig` and Tauri's
Base64 minisign box as `manifest.windows-x86_64.sig`. Do not reserialize the JSON.

After both signatures exist, supply **public-key files** matching the native
compiled pins (never keys from the candidate itself):

```sh
node tooling/scripts/desktop-update-v1.mjs bundle \
  --manifest manifest.json --macos-artifact "$MAC_ZIP" --windows-artifact "$WIN_EXE" \
  --macos-signature manifest.macos-arm64.sig \
  --windows-signature manifest.windows-x86_64.sig \
  --macos-public-key macos-update-public-key.txt \
  --windows-public-key windows-update-public-key.txt \
  --output new-desktop-update-bundle
```

This refuses either bad/missing signature or a changed package, copies packages
without overwriting an existing bundle, rehashes copied bytes, then creates the
local discovery pointer last. Native code signing, package contents and installed
recovery still require their native verifiers; this tool verifies detached
signatures and artifact binding, not Developer ID, Authenticode or G3 acceptance.
Uploading the result or advancing a customer pointer is a separate authorized,
gated operation. Re-signing or stapling after measurement requires a new manifest
and both signatures.

`desktop-update-sign.yml` runs `measure`, `assemble`, both signatures and `bundle`
for a real pair. An operator dispatches it on `release/windows` with the two
release-workflow run ids, the source SHA, sequence, version and channel. Before
measuring it binds each producer run (workflow file, `workflow_dispatch`, release
line, SHA, success, build-job env), its artifact by id and digest, and the package
contents: the macOS receipt, sealed `tono-build-source.json`, Info.plist channel and
key, Developer ID/notarization and release gate; the Windows installer signature,
version resources, and the floor and updater key compiled into `tono-service.exe`.
Each private key is used in one step of its own environment job (`macos-appcast`,
`windows-release`), through env or stdin. Both signatures are verified under the
pinned keys before the bundle is uploaded as a 30-day workflow artifact. The token
is read-only and there is no release, feed, bucket or promote step.
