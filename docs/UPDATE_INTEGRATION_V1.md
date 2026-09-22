# G3: native update transaction integration

This is the implementation contract for #26, following the shared value model
in [UPDATE_PROTOCOL_V1.md](UPDATE_PROTOCOL_V1.md). It is not acceptance evidence.
The owner requested real macOS/Windows integration and permits manually replacing
legacy clients. Source work does not authorize signing, deployment, feed changes
or device installation. Product version remains 0.0.73 during development.

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
