# Tono Update Protocol v1 — shared desktop contract

Scope: [#26](https://github.com/raydocs/tono/issues/26), SHIP_PLAN G3.
The owner requested one macOS/Windows product update protocol and can manually
replace legacy clients. This document specifies the common release manifest,
receipt shape and pure progress guard in Swift and Rust, with shared conformance
inputs. Native callers, signature verification, private stores and replacement
executors belong to [UPDATE_INTEGRATION_V1.md](UPDATE_INTEGRATION_V1.md). Shared
conformance is not native installation or release acceptance. Product version
remains 0.0.73.

The protocol version is independent of the macOS Helper and Windows Service IPC
capability versions. Those local versions change with their native adapters;
they do not need the same number. Existing user journals remain diagnostics,
never input to a trusted v1 receipt migration. No protected legacy bridge is
planned.

## One wire shape, not two similar phase names

Production value implementations:
- `apps/macos/Tono/Models/UpdateContractV1.swift`
- `apps/windows/crates/tono-core/src/update_contract.rs`

`ReleaseManifest.decode` and `Receipt.decode` check shape/bindings only. Anyone
can construct these public values. Neither decoding nor `propose` confers
authority. Native callers must verify signatures, peers, observations and
storage; passing App claims to these functions does not authenticate them.

Wire rules (including digest input): compact UTF-8 JSON with recursively
lexicographically sorted object keys, array order preserved, exactly one final
LF, no BOM/other whitespace, and no alternative character/number escapes. All
model strings are ASCII identifiers or enums. This deliberate restriction lets
the two decoders reject duplicate/ignored keys, float-to-integer coercion and
null-vs-absent drift by exact typed re-encoding. It is **not** a general JSON
canonicalization or signing algorithm. Unknown fields/versions are rejected,
including nested fields. Neither reader silently drops future requirements.

Each document is at most 16,384 bytes including LF. Epoch times are integer UTC
seconds, not ISO-8601 or milliseconds. Generations and timestamps are bounded by
9,007,199,254,740,991; generations are nonzero. SHA-256 is 64 lowercase hex;
source commit is 40 lowercase hex. Optional fields are omitted, not `null`.
Identifiers use `[A-Za-z0-9._:-]`, nonempty, with the bounds below. Version text
is a label, **not** a downgrade comparator or installed-identity proof.

### Release manifest (to be signed by native publishers)

| Required key | Shape |
|---|---|
| `kind`, `protocolVersion` | `tonoUpdateManifest`, integer `1` |
| `releaseId`, `appVersion` | At most 128 / 64 identifier bytes |
| `releaseSequence` | Integer 1–9,007,199,254,740,991; publisher-assigned monotonic release order, not a version-string comparison |
| `buildCommit` | Source commit identity; not a claim of a clean/signed build |
| `targets` | Exactly one `macos-arm64` and one `windows-x86_64` target |
| target `id` | One of those two identifiers; not the native updater's feed key |
| target `artifactSha256`, `artifactSizeBytes` | Expected archive digest and 1–4,294,967,296 bytes |
| target `components` | Required `appSha256`, `coreSha256`, `privilegedSha256` |

One release/build binds both targets, but their bytes, native signing identities,
installers and OS verification remain distinct. There are no URLs, arbitrary
paths, keys or signature-trust booleans in this model. Detached signatures cover
these **exact manifest bytes** with platform-scoped pinned verifiers; native
admission must also protect against downgrade/replay. No signing keys are
combined here.
Component digests describe expected executable bytes; native verification must
also check the macOS code signature/bundle or compiled Windows publisher policy,
protected installed location, dependencies and authenticated execution identity.
SHIP_PLAN permits an initial Windows release without Authenticode, not unsigned
update authority. A file hash alone is insufficient on either platform.

Before the first v1 activation, both implementations include `releaseSequence`.
The privileged adapter must compare it against its durable consumed high-water
mark and the installed build's floor, under the same lock as attempt admission.
Do not lower that mark after rollback or infer ordering from `releaseId`.
This field's shape check is not itself replay protection. Implementation and
packaging boundaries are specified in [UPDATE_INTEGRATION_V1.md](UPDATE_INTEGRATION_V1.md).

### Privileged receipt (private store, not App-owned JSON)

| Key | Shape / binding |
|---|---|
| `kind`, `protocolVersion` | `tonoUpdateReceipt`, integer `1` |
| `attemptId` | 64 lowercase hex; coordinator-generated random 256-bit identifier, not a bearer credential |
| `owner` | At most 128 identifier bytes; native adapter's authenticated principal key, not an email or App claim |
| `initiatingGeneration` | Coordinator-admitted initiating session incarnation |
| `installedLocationSha256` | Native adapter's independently validated registered installation identity digest, not an App-supplied path hash |
| `manifestSha256`, `targetId` | Exact canonical manifest digest and one admitted platform target |
| `requiredRecovery` | `connected`, `protectedOffline`, `unprotected`, or `unknown` while preparing |
| `createdAtUnix`, `updatedAtUnix`, `expiresAtUnix` | `0 < created ≤ updated < expires`; maximum 48-hour attempt lifetime |
| `phase` | One successful proof phase below, including while blocked |
| `successorGeneration` | Absent before installed identity proof; thereafter required and greater than initiating generation |
| `blockedReason` | Optional `preparationFailed`, `installationUncertain`, `recoveryFailed`, `cancelled` |

The principal/location derivation recipes, native session incarnation mapping
and cross-restart monotonic generation allocation belong to the native adapters,
not the wire decoder. A local App generation counter that resets at startup is
not this ownership proof. Receipt expiry or a clock rollback refuses further
grants without erasing the last durable record or releasing protection. Expiry
is **not** proof that installation did not happen.

## Authorization and installation facts are different

```
preparing → installationAuthorized → installedIdentityVerified
          → recoveryVerified → committed
```

All authoritative persistence belongs to Service/root Helper. Other components
submit requests/evidence, never an authoritative `advancePhase` request.

| Phase | Required privileged observation before durable advancement |
|---|---|
| `preparing` | Reserve one owner/target-bound attempt before update-specific quiescing or ownership changes. No installation permission. |
| `installationAuthorized` | Native package/signature/input binding verified; Core/TUN stopped and DNS/proxy cleanup verified; captured protection retained. Protected attempts must be Protected Offline, truly unprotected attempts unprotected. Unknown obligations cannot advance. |
| `installedIdentityVerified` | Authenticate successor at the registered location, independently observe actual target components, durably transfer ownership to one fresh generation. Version strings/App claims cannot substitute. |
| `recoveryVerified` | Native runtime, PF/WFP and DNS converge to the exact captured obligation. Protected Offline is not Connected; successful spawn is not convergence. |
| `committed` | Revalidate live identities and recovery under the owner lock, then durably commit and retain replay-resistant consumed evidence. |

`blockedReason` retains `phase` as the last proof. It does not invent successful
intermediate phases or imply that an uncertain installation failed. Blocked
attempts cannot automatically resume/commit. Forged/out-of-order requests reject
without poisoning a valid transaction into blocked state. Committed attempts
cannot advance again. Exact retries may query durable state, not mint a second
grant; the pure proposal function intentionally refuses same-phase replay.

`Observation`/`Context` are local, non-decodable values. Their production source
must be the privileged adapter's actual observations/authentication, not parsed
App booleans. `propose` returns a separate candidate value. It does no disk I/O,
serialization locking, signature verification, installation or network change.
Discarding a proposal leaves the old value intact; a failed write must do the
same. **Cloning/reloading an old value is not prevented here**: durable
serialization, restart reconciliation and single-use consumption are still
adapter obligations, not proven by the pure model's commit-replay rejection.

The pinned Sparkle 2.9.6 public delegate does not expose a root-authenticated
installer-entry acknowledgement or downloaded archive path. Its continuation
requests stage 2, not proof of replacement. `applicationContinuationRequested`
always fails the authoritative progress guard. Verified installer entry remains
a separate optional native observation, never inferred from that callback.

This model can prove the authorized target is now installed **after native
verification**, not which installer caused the replacement. It cannot establish
one-use physical installation, pre-mutation receipt consumption, or artifact
binding merely by renaming a callback. **G3's existing installer-owned
InstallStarted requirement is not silently discharged/replaced by this model.**

### Terminal resolution and successor re-adoption (clarified 2026-09-22)

This subsection records two adapter obligations that the clauses above already
permit but one native round left implicit; it changes no earlier requirement.
Both were specified while fixing the macOS adapter, whose consumed transactions
had exactly one exit (commit) guarded by a single process incarnation.

**Resolved retirement.** A consumed-side attempt that can no longer reach
`committed` through its bound incarnations — executor-blocked before
replacement, rolled back, expired, or explicitly abandoned after replacement —
must still have one privileged terminal path: archive the evidence and clear
the active slot without lowering the consumed high-water mark. Admission
requires the same verified explicit Disconnect (or an administrator's
equivalent emergency release) as unconsumed retirement, an observed
`unprotected` recovery, and an independent on-disk component proof: the
captured original components for pre-replacement and rolled-back attempts, or
the signed target components for an abandoned replaced installation. Archiving
is not cancellation, resume, or commit; the archived receipt keeps its last
proof phase and a terminal blocked reason, and a rollback that never lowered
the high-water mark is not lowered by retirement either.

**Successor re-adoption.** The successor grant binds one *live* App
incarnation — an audit token valid within one boot — not the first one
forever. When the bound incarnation is provably gone (different boot session,
or its token no longer resolves to a live process), a freshly authenticated
peer at the verified target installation may re-bind the grant: a fresh
successor generation, the same durable proof phase. While the bound successor
is provably alive, no other incarnation may take the grant. This is the
adapter-level twin of the executor's own successor relaunch; it adds no wire
field and no phase transition.

## Interrupted-transaction recovery and terminal states (2026-09-22 clarification)

This section clarifies how a pending transaction ends when its recorded
process incarnations disappear. It changes no rule above: the pending gate,
evidence retention, anti-impersonation on first successor adoption, the
single-execution rule and high-water monotonicity all keep their meaning.
The initiating process is terminated by the executor and successors may exit
before commit, so a transaction must not become unreachable merely because
its recorded incarnations died.

- **Disconnect authority is installation identity, not incarnation
  equality.** Disconnect request, verification and retirement accept the
  authenticated owner's process at the registered install root whose current
  bytes hash to the original or target App component digest. A peer outside
  that registered identity still cannot Disconnect.
- **Successor re-proof after the recorded successor dies.** Once the recorded
  successor incarnation is gone, a later process at the registered location
  whose bytes are the verified target, which postdates the recorded successor
  and does not recycle its pid, re-binds as the provable successor. First
  adoption remains executor-creation proof; this is re-proof, not a second
  first adoption.
- **Recovery classifies by installed identity, not successor liveness.** A
  reboot, or a user closing the new App before commit, is not an interrupted
  publication. Recovery rolls back only when no durable plan exists or the
  installed components are not the signed target. `TargetVerified` also
  requires every member of the durable replacement plan (the payload tree,
  `tono-service.exe` and `core-sha256.txt`) to hash to its `new_digest`;
  three matching binaries with a later member still old is an interrupted
  publication and rolls back (2026-09-23). A member that cannot be read
  (sharing violation, AV lock) is not a mismatch: recovery exits with the
  error before any rollback touches a file, leaving the attempt `Uncertain`
  for the next recovery, as an unreadable binary already did. A complete,
  verified publication stays installed; a successor that was never durably
  registered is replaced by measured-target evidence and the first
  authenticated target-identity App adopts it.
- **Terminal archives after verified Disconnect.** An unconsumed attempt
  whose recorded executor incarnation is provably gone, and a rolled-back or
  uncertain attempt whose installed components equal the retained originals
  — and, when a durable plan exists, whose every plan member hashes to its
  `old_digest` (2026-09-23) — archive their full record and clear the live
  slot. The consumed high-water never lowers and explicit release never
  becomes commit.
- **Bookkeeping after release is not a release failure.** Once Disconnect
  has released WFP, a failure to prove that release for the evidence or to
  archive the record leaves the attempt pending and returns success with
  `needs_attention`. An Err response means no protection release completed;
  only that makes the App keep Protected Offline. New archive checks added to
  this path follow the same rule.
- **Installed and released (2026-09-23).** A `Replaced` attempt whose owner
  then completes a verified explicit Disconnect (for example, the post-upgrade
  reconnect failed and the user restored internet) also archives its full
  record and clears the live slot, so connect, update, Quit/sign-out release
  and uninstall are reachable again. Preconditions: the installed components
  equal the signed target, every member of the durable replacement plan
  (payload tree and `core-sha256.txt`) hashes to its `new_digest`, the
  Disconnect readback is verified unprotected, and the requesting process is
  a provable target-identity successor at the registered install root (old
  App bytes may Disconnect but cannot end a replaced attempt). This is not
  commit: phase, recorded obligation, successor evidence and the
  sequence/generation high-water are archived unchanged, and the `Committed`
  cleanup path is not taken. Backup ownership: because no commit or executor
  will run for the attempt again, the Service removes the retained
  `.rollback`/`.restore`/`.publish` copies bound to each plan member before
  clearing the slot (otherwise they would refuse the next update's
  preparation); private attempt evidence (payload, plan, executor, package)
  is retained. A failed removal leaves the attempt pending and retryable.
- **Launching without a live executor incarnation is provably unconsumed.**
  Consumption only accepts the exact recorded executor incarnation. When
  that incarnation is gone and the high-water still sits below the release,
  reconciliation returns the attempt to Staged — re-launchable by the same
  initiating App, retirable through Disconnect — because nothing executed;
  this is not a second execution grant.

Limits of this clarification (stated so it is not over-read):

- **Effective only from a build that already contains it.** `Prepare` copies
  the *installed* `resources/tono-service-install.exe` into the transaction
  as `executor.exe`; `--update-recover` and the ONSTART recovery task run that
  copy, and every pre-publication Service check runs in the installed
  Service. An upgrade that starts from 0.0.73, or from any build without this
  change, therefore runs the old executor and old Service: the recovery
  classification and Launching reconciliation above do not apply, and only
  the post-publication part served by the new Service does. This is not G3
  evidence for the first hop from 0.0.73; it protects the next upgrade that
  starts from a build containing it.

## Local store schema across versions (2026-09-23)

The private stores (macOS helper `ledger.json`, Windows Service `state.json`)
are read by an **older** binary after a newer one wrote them: the executor is a
copy of the previous signed helper / `tono-service-install.exe`, and the new
helper/Service keeps writing the store after publication. Wire documents above
(manifest, receipt, requests) keep their exact-shape rules and
`protocolVersion`; this section covers only the local store around them.

- **Storage major.** `schemaVersion` (macOS) / `schema_version` (Windows) is an
  integer major. Absent means `1`, the current unversioned layout. Writers emit
  it only once they write `2` or later, so every build that already reads v1
  stores keeps reading them.
- **Same major: unknown fields are ignored.** A reader accepts fields it does
  not know. macOS still requires every field it knows to carry exactly the
  canonical value it decoded; only additive keys are skipped.
- **Additive fields must be optional and safe to drop.** An N-1 executor may
  rewrite the store without them, so their absence must mean the safe default.
  A field whose loss or misreading could grant authority, clear an obligation,
  or change recovery is not additive.
- **Anything else bumps the major.** A reader refuses a higher major with a
  distinct "written by a newer Tono" error and retains the bytes. That is not a
  corrupt store, but it still blocks exactly like pending evidence until a build
  that understands the major handles it.
- **Release check.** Before shipping a store change, the previous release's
  executor must read a ledger written by the candidate. A new major also needs a
  plan for machines whose executor is the previous release.

## Automated conformance and its limits

`tooling/scripts/tests/fixtures/update-protocol-v1/` contains synthetic manifest,
receipt and refusal/replay inputs, not signatures or actual customer evidence.
Swift's `testSharedWireAndOwnershipContract` and Rust's
`shared_wire_and_ownership_contract` run those same bytes against the real
implementations. Fifteen malformed-document cases, four bounded replays with
33 steps and an oversized-input check distinguish the plausible wrong answers:
ignored future fields, permissive numeric decoding, expired/wrong-owner grants,
old-generation adoption, wrong artifacts/components, fake continuation progress,
unknown/unprotected confusion, skipped recovery and repeated commit.

Both implementations also round-trip receipt bytes between successful steps;
this is model serialization/re-entry, **not a process crash or durable store**.
The fixture manifest digest is independently fixed from the on-disk bytes.
No Python/JavaScript replica is used as a substitute for Swift/Rust execution.

Run the existing hosted lanes, not MacBook compilation or a toolchain downgrade:
- Ubuntu: `cargo test --locked -p tono-core` in `apps/windows` includes the new integration target.
- Windows: `cargo test --locked -p tono-core --test update_contract shared_wire_and_ownership_contract -- --exact --nocapture`; enumeration first rejects a missing test.
- macOS: existing TonoTests `xcodebuild ... test` includes the one new XCTest.
  A checked fixture digest emitted by that test is required, so an absent target
  cannot produce green acceptance. The existing test command must also succeed.

Changes to either implementation/test or shared fixtures trigger both existing
native workflows. No new runner, privileged secret, dependency or manual dispatch.

## Native acceptance gates — #26 stays open

1. **Windows:** verify private signed inputs, Service-owned cross-process durable
   admission and consumption **before** live/repair-resource mutation, independent
   executor recovery, and authenticated successor adoption. No broad user-journal
   scan is an authority source.
2. **macOS:** verify root Helper authentication/persistence, private full-bundle
   staging, independent executor continuity and successor recovery. The native
   integration uses a Tono-owned installer, not Sparkle installation or a private
   Sparkle hook. Hashing another download or blessing an App callback is not
   package or execution identity.
3. **Both:** crash/write-failure injection at every persisted owner boundary,
   cancellation/Disconnect/reboot/rollback and expired attempts, then authorized
   installed-device PF/WFP/DNS/packet evidence. Signing and customer update-channel
   qualification remain separate gates. Passing conformance closes none of them.

Manual replacement of legacy clients does not authorize automatically disarming
unknown protection. New adapters must refuse unsupported protected handoffs;
normal verified Disconnect/manual installation is the migration route. Do not
promote customer feeds or call source integration a stable update rollout.
