# M1 build and offline certification tooling

Product integration now uses [the v2 shared contract](product-contract.md),
[release/resource identity](release.json), and [JSON template](runtime-template.json).
The builder pins and frozen M0 fixtures below remain unchanged. New JSON rules
do not require a different core build; native application remains a separate gate.

## Check the shared integration branch locally

Use a clean checkout of `origin/feat/shared-sing-box-contract` and compare
`git rev-parse HEAD` with PR #202's head before recording results. To avoid
overwriting an existing checkout, run these from an existing Tono checkout:

```sh
git fetch origin main feat/shared-sing-box-contract
git worktree add --detach ../tono-shared-verify origin/feat/shared-sing-box-contract
git -C ../tono-shared-verify rev-parse HEAD
```

Run subsequent commands from that new worktree's root. Python-only checks need
Python 3.10+ and do not build or start a product:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tooling/scripts/sing-box -p 'test_*.py' -v
```

Expected: **20 tests, OK (skipped=1)** without `TONO_SINGBOX_CHECK_BINARY`.
The skipped test is a real-core parser check, not a passed parser check.
For all 20 checks on a disposable **Linux x86_64** host, supply the retained
M1 Linux binary, or reconstruct it with the pinned builder documented below:

```sh
PYTHONDONTWRITEBYTECODE=1 \
TONO_SINGBOX_CHECK_BINARY=/absolute/path/to/approved/linux-amd64-v2/sing-box \
python3 -m unittest discover -s tooling/scripts/sing-box -p 'test_*.py' -v
```

The parser test checks the binary SHA from `release.json` before execution,
checks two handwritten product shapes with a 15-second bound per invocation,
and rejects a bad Reality key. It never invokes `run`. These are **not actual
Rust/Swift emitted-byte checks, TLS handshakes or native protection receipts**.
An upstream release download has a different binary hash and must fail here.

On a permitted Linux/Windows build host with Rust **1.98 or newer**, run the
focused shared Rust regressions (do not implicitly compile on the MacBook):

```sh
cargo test --manifest-path apps/windows/Cargo.toml --locked -p tono-core sing_box::
```

Expected at the tested source: **17 passed**, comprising the 13 frozen M1
tests plus four product-compiler regressions. To match the existing hosted core
job exactly, omit the `sing_box::` filter. This is portable compiler coverage,
not PF/WFP, Service/helper, installer or Connected acceptance.

### Durable evidence and retained artifacts

The unchanged emitter source at
[`c1bf5049`](https://github.com/raydocs/tono/commit/c1bf5049b25d9a27bd35afac2d8a58f9dc16f115)
passed [Windows CI](https://github.com/raydocs/tono/actions/runs/34905344106),
[PR Windows CI](https://github.com/raydocs/tono/actions/runs/34905348688), and
[macOS CI](https://github.com/raydocs/tono/actions/runs/34905348835): 11 checks
passed. The hosted core log records **260 unit + 14 integration tests passed**,
including all four `sing_box::runtime::tests`. The later main reconciliation
imports only main's guidance/home-agent documentation; no emitter, Cargo or
runtime-template bytes change. This is explicitly prior-SHA evidence, not a
claim that a documentation/manifest follow-up already passed new CI.

All three original build manifests are now committed byte-for-byte under
`manifests/<build-target>.json`. Their hashes match `release.json` and the
independent M1 handoff below; source, Go, tags, modules and unsigned binary
identities are preserved. Their `M1_OFFLINE_NOT_INSTALLABLE` scope is deliberate:
archiving provenance does not authorize installation or signing.

Binary executables, upstream archives, Go/toolchain/module caches and raw CI
logs stay outside Git. They are large reproducible/downloaded inputs or raw
diagnostics, not missing source changes. Rebuild instructions, provenance and
CI permalinks are retained here; binary transfer paths are below. If the old
build Orb is unavailable, obtain the approved inputs and rebuild; do not
substitute a different official binary or pretend these binaries were uploaded
as a GitHub release. No release/upload-to-customer-channel was performed.

Remaining blockers: a real QUIC DER verifier for Tono HY2, resolver redundancy,
platform-owned Swift/Service and native DNS/PF/WFP/installer verification,
and deletion of old YAML APIs only after atomic migration of all callers.
The branch is an integration draft, not a complete Mihomo replacement.

## Historical M1 build contract

This package owns only CONTRACT §6's build/authentication-boundary work. It
supports SHIP_PLAN G1/G2 evidence without closing a gate. The only baseline is
[M0 7f64978c](https://github.com/raydocs/tono/commit/7f64978c5d9d5b8551e0b81f7247cb5a630ebf56).
The M0 directory remains single-writer and is not modified here.

## Trust and execution boundary

- Run on a disposable Linux build/check host, with Python 3.10+ and **already
  provisioned trusted Go1.27.1**, clean pinned source and populated module cache.
  This script does not download a toolchain, source, modules or a fallback core.
  Missing offline dependencies fail. MacBook native compilation is not allowed.
- `candidate.json` and `reference.json` are SHA-256 anchored to M0 before use.
  Build consumes the candidate's commit, module hashes, four tags, target CPU
  level, linker version and readonly/trimpath flags. No patches, no Hy2 changes.
  Source cleanliness (including ignored/hidden-index files), module checksums
  and `go mod verify` precede compilation; source is checked again afterward.
- `build` writes one unsigned binary and `manifest.json` to a **new absolute
  directory outside this repository and the source checkout**. It never writes
  Resources, sidecars, formal core identity, installers or an update feed.
  Failure may leave partial build output but never a successful manifest.
- `verify` requires a manifest digest obtained independently from the trusted
  build handoff, then validates its exact contract/target, the binary's actual
  SHA-256 and Go build info. An adjacent, self-supplied digest is not provenance.
  Hashes/build info are not signatures or proof against a malicious build host,
  compiler or a writer sharing that host. Use an exclusively owned workspace.
- `check` copies the verified Linux binary to private temporary staging and
  rechecks its hash before executing **only `check -c`**, with a 15-second process
  group watchdog. No `run`, listener/TUN startup, requests, POST replay or fallback.
  Only the complete frozen synthetic reference is accepted. This is not a
  general JSON-to-product admission interface or a third platform emitter.
  Swift/Rust owners still must prove full snapshot/default/derived-policy
  rejection at their native boundaries.
- Reject home keys even when empty, nonempty/unknown policy and derived DIRECT
  requirements, unknown routing and Hy2 even on unselected nodes. Other fixture
  drift also fails closed rather than silently stripping requirements.
- The positive checks cover both platform JSON shapes using Linux; an invalid
  Reality key must fail with exit 1 and the expected parser diagnostic. These
  are **not Reality handshakes, Hy2 DER authentication, native DNS/PF/WFP proof,
  Connected state, installable candidates or performance evidence**.

## Commands and JSON outputs

Run from the repository root. Paths below are placeholders for approved,
preprovisioned inputs, not commands to fetch/install anything.

```sh
sh tooling/scripts/build-sing-box.sh build \
  --source /approved/sing-box --go /approved/go/bin/go \
  --target linux-amd64-v2 --output /external/new-linux-build
```

Repeat with a different new output directory for `darwin-arm64` and
`windows-amd64-v2`. Each target has its own binary hash and manifest hash;
Linux hashes must never be relabeled as native evidence. Do not run target
binaries just to read a banner: build identity is read with `go version -m`.

```sh
sh tooling/scripts/build-sing-box.sh verify \
  --go /approved/go/bin/go --target linux-amd64-v2 \
  --binary /external/new-linux-build/sing-box \
  --manifest /external/new-linux-build/manifest.json \
  --manifest-sha256 '<independently retained build output digest>'

sh tooling/scripts/build-sing-box.sh check \
  --go /approved/go/bin/go --target linux-amd64-v2 \
  --binary /external/new-linux-build/sing-box \
  --manifest /external/new-linux-build/manifest.json \
  --manifest-sha256 '<independently retained build output digest>' \
  --fixture docs/reports/sing-box-evaluation/migration-m0/reference.json \
  --output /external/new-check-evidence

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tooling/scripts/sing-box -p 'test_*.py' -v
```

Success stdout is JSON with `ok: true` and an explicit non-qualification status.
Build returns `target`, `binary_sha256`, `manifest_sha256`; verify returns
`target`, `binary_sha256`. The manifest's closed v1 shape records the M0 commit,
candidate hash, exact source/build/target, filename, binary hash and module/build
info. There are no catalog/policy verification flags or product runtime fields.

Check returns and stores only `check.json`: profile, binary hash, node count,
anonymous selected index, each platform shape's **actual UTF-8 byte hash**, exit
0 and the invalid-key exit 1. No runtime, node name, server, UUID, Reality key or
controller secret is persisted. Redaction is an allowlisted structured summary,
not string replacement in arbitrary diagnostics. Tool stdout/stderr stays private
and is deleted; errors never echo it. Duplicate JSON keys, BOM, over-8-MiB input,
nonstandard constants and unknown manifest/fixture fields are rejected.

Operational failures return exit 1 and `{"ok":false,"error":"TONO_SINGBOX_…"}`.
Timeout has its own `TONO_SINGBOX_TIMEOUT` code, never success. CLI syntax errors
are argparse usage errors (exit 2). There is no retry after failure.

## Executed M1 evidence — 2026-09-14

The following builds and checks ran in a Linux x86_64 Orb using tooling commit
[39c33288e47f4debf0da63c9371d5c9a8504bcfa](https://github.com/raydocs/tono/commit/39c33288e47f4debf0da63c9371d5c9a8504bcfa).
This follow-up changes documentation only; it does not change the tested scripts.
No source, toolchain, candidate, reference or dependency pin was substituted.

### Inputs were authenticated before extraction

The M0 owner supplied retained files through Amp `download_thread_file` from
[the M0 thread](https://ampcode.com/threads/T-01a09b11-ffa7-7182-9dee-0aec721381a6),
prefix `.amp/m0-retained-transfer-20260914/`, into new directory
`/tmp/tono-m0-inputs`. All 11 entries in `SHA256SUMS` passed. Independently supplied
hashes also matched before tar extraction:

| Input | SHA-256 |
|---|---|
| Go1.27.1 linux/amd64 archive | `63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445` |
| Clean sing-box Git export | `4033e34c4e637a9f8b6f124879aac9cd5e6e6634752c457e79bf8085e027cd34` |
| Retained historical Linux core | `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df` |

Archive members were checked for absolute/traversing paths and restricted to
regular files/directories. Restored Git HEAD matched M0's upstream commit,
working tree was clean, go.mod/go.sum matched candidate hashes, and `go version`
returned `go version go1.27.1 linux/amd64`.

The first offline build correctly refused the absent module cache:
`TONO_SINGBOX_COMMAND_REJECTED`, with no output manifest. Direct diagnosis was
`filippo.io/age@v1.3.1: module lookup disabled by GOPROXY=off`. A separately
bounded, approved cache-preparation command succeeded in the pinned source:

```sh
timeout --signal=TERM --kill-after=2s 240s env -i HOME="$HOME" \
  PATH=/tmp/tono-m0-inputs/go/bin:/usr/bin:/bin GOENV=off GOWORK=off \
  GOTOOLCHAIN=local GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
  GOFLAGS=-mod=readonly GOTELEMETRY=off \
  /tmp/tono-m0-inputs/go/bin/go mod download
```

Both module-file hashes and the clean source state were rechecked unchanged.
The build script still runs offline (`GOPROXY=off`), including `go mod verify`;
cache preparation did not introduce automatic network fallback into it.

### Three new M1 artifacts have distinct identities

All three `build` and subsequent `verify` commands returned exit 0. Each used
`--source /tmp/tono-m0-inputs/sing-box-source`,
`--go /tmp/tono-m0-inputs/go/bin/go` and the commands documented above.
Output directories were `/tmp/tono-m1-linux-r1`, `/tmp/tono-m1-darwin-r1`, and
`/tmp/tono-m1-windows-r1`. Verification used each independently retained manifest
digest below. Go build info matched pinned revision, clean source, Go, CGO,
tags, module graph and target. `file` independently identified ELF x86-64,
Mach-O arm64 and PE32+ x86-64 respectively. Neither the macOS nor the Windows
binary was executed.

| Target | Binary SHA-256 | Manifest SHA-256 |
|---|---|---|
| linux-amd64-v2 | `120b91c702a2b3d15ce09ca5ce850d5e8880ca65a4017950df91cadd276eabd2` | `ab39c6c4d5147844faaccb6a32189c090948bc06f5202c63bd33d8db757ab1e1` |
| darwin-arm64 | `6c86720c7baf60057ad9ea05b64149939d29a37397e93599563de0db5677baae` | `c765b9d2cc7d1cb31debd9bc699cb906bdd495e0cde08f401527879ac7eb394a` |
| windows-amd64-v2 | `9fa8e825a697ccea2beed17d8766af947084041173df4d80b622e2bf730d544f` | `2f5642f51c03a620f870c069239ad8b35d93e123903765da430e62070e00f757` |

These use M1's frozen linker label, not the retained historical banner. Passing
the retained binary to `verify` with the new Linux manifest returned exit 1,
`TONO_SINGBOX_HASH_MISMATCH`; the historical artifact cannot be relabeled as M1.

### Actual bounded parser checks passed, without connection claims

The new Linux artifact passed the package's `check` command with its verified
manifest and the complete frozen reference. Both platform shapes returned 0;
the invalid Reality key returned 1 with the required `invalid public_key`
diagnostic. Only the redacted receipt survived staging cleanup:
`/tmp/tono-m1-linux-check-r1/check.json`, SHA-256
`4c36c49e02797526ba7b8b98668c84f538b0bb4be08052c0fb14ccac15268493`.

| Actual runtime bytes | SHA-256 | Result |
|---|---|---|
| Windows shape | `85723e709aef8b6925a2aca6c150805bcec0c824308fb61a7d85c61f9bfa712e` | check exit 0 |
| macOS shape | `1c7451f41f594331ef34e984ce85057524b96c6cab876ffd5a073f08f019aca3` | check exit 0 |

The retained core was separately authenticated against its M0 hash/build-info
and passed the same two shapes and invalid-key negative control; those results
are historical-core checks, not new-build evidence. A separate 0.1-second
watchdog around 5-second sleep returned 124 as expected, never success.

The Python command above still reports **17 tests / OK**. Those unit tests
deliberately mock compiler/build-info/parser calls; only the checks described
in this section are actual core execution. `sh -n` and diff whitespace checks
also pass. At the tested tooling commit, macOS CI runs
[34851329925](https://github.com/raydocs/tono/actions/runs/34851329925) and
[34851336055](https://github.com/raydocs/tono/actions/runs/34851336055) each completed
all three jobs successfully. That existing CI is not sing-box native acceptance.

### Transfer and remaining boundaries

The new binaries/manifests were copied, not installed, into this build thread's
untracked transfer directory. Use `download_thread_file` from
[the build thread](https://ampcode.com/threads/T-01a0a020-b40e-701d-8c3c-1b88cd829e81),
with prefix `.amp/m1-build-transfer-20260914/<target>/`. Each target contains
`manifest.json` and `sing-box` (`sing-box.exe` for Windows); Linux also contains
`check.json`. Create a fresh external destination, verify the hashes above,
and set executable permission only when needed for a bounded Linux check.
This is a valid executor-backed cross-thread transfer, not a permanent public
attachment. Download before the source Orb is archived. No binary is committed.

The missing-input/new-build blocker is resolved. Downstream Swift/Rust emitter
checks remain their owners' responsibility and are not inferred from reference
checks. No native DNS/PF/WFP, network handshake, Connected, installer/update,
M2 candidate or performance evidence was produced. No `run`, production change,
signing, deployment, merge or publication occurred; M2 still requires review.
