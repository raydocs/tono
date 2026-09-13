# G1: update the optional Home sidecar's netmap stability patch

Closes [#175](https://github.com/raydocs/tono/issues/175) (the pinned-version drift
item only). This does not close G1 or certify an installed Home connection.

## Why this patch, not a speculative core migration

[Tailscale's 2026-09-10 release notes](https://tailscale.com/changelog) identify a
connectivity failure when a netmap update coincides with reauthentication.
[The four-commit source comparison](https://github.com/tailscale/tailscale/compare/v1.102.3...v1.102.4)
includes the release-branch netmap repair: expiry handling must use current peers
under the backend lock, delta removal must preserve a newer index owner, and
profile/cache changes must follow the actual deltas. The Kubernetes-only change
is not the reason to update Tono's sidecar. No Tono-installed reproduction or cure
for all reported disconnects is claimed.

This is Tono's existing optional userspace Home sidecar, not Mihomo's Reality/Hy2
core and not the sing-box experiment. Privilege boundaries, fail-closed rules,
profiles and connection selection are unchanged. No new sidecar path is added.

## Exact source and assets

- Old: `v1.102.3`, `53a0d659afa51835dd7a9283873cca44261454f8`.
- New: `v1.102.4`, `bbcd7d1fc2054b9189ebc1531acf74bd880ca0c8`.
- Ran the actual `tooling/scripts/build-tailscale-sidecar.sh` in an isolated Tono
  worktree, using Go 1.27.1, CGO=0, darwin/arm64 and the existing flags.
- The repository tracks both Mach-O resources; the old resources' Go metadata
  confirmed the old commit. Updating only the script would leave the bundled
  code old. Both tracked resources are therefore rebuilt alongside the pin.
- Both new binaries' Go build metadata reports the exact new commit and
  `vcs.modified=false`; license/dependency versions are unchanged in this patch.

| Resource | SHA-256 before release codesigning |
|---|---|
| `tailscaled` | `efef0e56df3724db230b9dc5d0a24646d955a96c6ae96afb21a69916b82f9c9f` |
| `tailscale` | `157ec35c9f110d7019a9093e0861f30c1860a32528e2962ea8b1f55b3bac08f0` |

## Verification and limits

Five existing upstream top-level regressions passed on the pinned, clean source:
`TestUpsertReplaysUserProfiles`, `TestUpdateNetMapCache`,
`TestNetmapExpiryTimerPreservesPeerDeltas`,
`TestNetmapExpiryIgnoredDuringControlClientShutdown`, and
`TestNodeBackendIndexReuseEviction`. The backend fixtures use an in-memory store
and fake userspace engine; these are not production reconnect or VPN tests.

Command: `CGO_ENABLED=0 GOMAXPROCS=4 go test -mod=readonly
./control/controlclient ./ipn/ipnlocal -run '<the five anchored test names>'
-count=1 -timeout=120s -json`. `sh -n` and `git diff --check` also passed.
Build log, raw Go test events and asset metadata are retained under
`/tmp/tono-tailscale-upgrade-20260913/`.

macOS build/test CI must pass before merge. No daemon/CLI was started, no Tailscale
login or production service occurred, and no installed helper, PF/DNS settings or
customer update source changed. Existing team codesigning/notarization and native
Home reconnect validation are still required before a customer release.
