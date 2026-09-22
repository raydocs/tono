# Tono Update Protocol v1 — shared, inactive contract

Scope: [#26](https://github.com/raydocs/tono/issues/26), SHIP_PLAN G3.
The owner requested one macOS/Windows product update protocol and can manually
replace legacy clients. This is the first implementation slice: the same release
manifest/receipt shape and pure progress guard in Swift and Rust, with shared
conformance inputs. **Neither platform's updater uses it yet.** No migration,
signature verifier, new IPC capability, privileged receipt store or installer
handoff is implemented here. Product version remains 0.0.73.

The protocol version is independent of macOS Helper 4.4.0 and Windows IPC 2.15.
Those local versions must change with their respective future adapters; they do
not need the same number. Existing user journals remain diagnostics, never input
to a trusted v1 receipt migration. No protected legacy bridge is planned.

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
paths, keys or signature-trust booleans in this model. The future signed envelope
must cover these **exact manifest bytes** with a platform-scoped pinned verifier
and protect against downgrade/replay. No signing keys are combined here.
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
| `attemptId` | 64 lowercase hex; future coordinator-generated random 256-bit identifier, not a bearer credential |
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
and cross-restart monotonic generation allocation belong to the future adapters
and must be specified/tested before activation. A local App generation counter
that resets at startup is not this ownership proof. Receipt expiry or a clock
rollback refuses further grants without erasing the last durable record or
releasing protection. Expiry is **not** proof that installation did not happen.

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

## Remaining implementation gates — #26 stays open

1. **Windows:** signed-input verification, private immutable staging, authenticated
   Service store with cross-process atomicity, exact installer-bound consumption
   **before** live/repair-resource mutation, authenticated successor adoption.
   No broad user-journal scan is an authority source.
2. **macOS:** root Helper authentication/persistence and replacement continuity;
   trustworthy binding to the actual Sparkle-consumed input. If public APIs cannot
   establish it, protected automatic upgrade remains unsupported; hashing another
   download or blessing an App callback is not a workaround. No Sparkle fork or
   production UI change is implied by this contract.
3. **Both:** crash/write-failure injection at every persisted owner boundary,
   cancellation/Disconnect/reboot/rollback and expired attempts, then authorized
   installed-device PF/WFP/DNS/packet evidence. Signing and customer update-channel
   qualification remain separate gates. Passing conformance closes none of them.

Manual replacement of legacy clients does not authorize automatically disarming
unknown protection. New adapters must refuse unsupported protected handoffs;
normal verified Disconnect/manual installation is the migration route. Do not
promote customer feeds or call this inactive foundation a stable update rollout.
