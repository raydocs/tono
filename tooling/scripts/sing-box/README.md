# M1 build and offline certification tooling

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

## Evidence required before this work can leave Draft

The Python tests use synthetic build info/mock compiler operations and local
subprocess watchdog controls. They must never be presented as actual Go builds
or sing-box checks. Run the three pinned builds, independent manifest/binary
verification and the real bounded positive/negative checks with approved inputs.
Attach exact tested Tono SHA, binary hashes and transferable artifacts to the
coordinator's handoff. Without those artifacts, downstream native emitter core
checks remain blocked. No change here authorizes M2 or a production invocation.
