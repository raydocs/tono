# Restricted Stage B — fixed identities

This directory adds evidence; all Stage A files remain byte-for-byte unchanged.
These are Linux **kernel/harness experiments**, not Tono's Linux product path,
PF/WFP acceptance, migration approval, or release evidence.

## Repository snapshots are separate from measured kernels

- Repository: https://github.com/raydocs/tono.
- Original local `main`: `1d00b581dffdd98e84821c8789eb0c46b7a21bed`, clean and unchanged.
- Stage A delivery: [`7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1`](https://github.com/raydocs/tono/commit/7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1), already uploaded. Its [reports](../BASELINE.md) remain the A record.
- Stage B worktree: `/home/user/workspace/tono-stage-b-20260913`.
- Branch: `experiment/sing-box-stage-b-lossless-20260913`, created from the A delivery, initially clean.
- At B start, one explicit fetch captured `origin/main` at [`6e430ef8c61df05a1739d10d1adfb55d1951f5c3`](https://github.com/raydocs/tono/commit/6e430ef8c61df05a1739d10d1adfb55d1951f5c3). No automatic tracking, rebase, reset, or substitution.

`git diff --stat 1d00b581..6e430ef8`: 14 files, +519/−114. Changes are Windows
protected update-restore proof (#165), macOS update-preparation cleanup (#166),
and Windows frontend dependencies (#169). Neither core identity JSON nor the
adaptive patch changed. This is a **source delta**, not another performance baseline.
PR #170 was subsequently reviewed separately; see [AUDIT.md](AUDIT.md).

## Three candidates, two binaries

| Label | Source / stack | Binary SHA-256 |
|---|---|---|
| A / `mihomo` | Tono `v1.19.30-tono-gvisor-adaptive.1`; upstream `ac017cdd246ce8bd547653d927e7bf77d7ee73d5`; adaptive gVisor | `c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4` |
| B / `gvisor` | sing-box `93fff5954390367dd456cad3cbd79be54f8b941f`; explicit `stack: gvisor` | `cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df` |
| C / `go` | **same sing-box binary**, explicit `stack: go` | same as B |

A reuses the exact [Stage A build](../BASELINE.md), including MetaCubeX
`github.com/metacubex/sing-tun v0.4.22` and patch SHA-256
`f33ee290cc979b739505777761b87f7933441e6bc94d0fc98bb75b42477f005b`.
It is not stock Mihomo. Neither official installer/build script nor product
Resources/sidecar was invoked or changed.

B/C depend on **SagerNet** `github.com/sagernet/sing-tun
v0.9.4-0.20260912075549-869f0a4d76af`. This is a different module/version family.
[`stack.go:46–67`](https://github.com/SagerNet/sing-tun/blob/869f0a4d76af/stack.go#L46-L67)
dispatches `go` to `NewGo`, `gvisor` to `NewGVisor`. The explicit stack option is
deprecated, but works at this fixed commit. `multi_queue` remains false.

Both builds: Go **1.27.1**, CGO=0, GOOS=linux, GOARCH=amd64, GOAMD64=v2,
`-trimpath`, `-mod=readonly`, `-w -s -buildid=`. Build parallelism GOMAXPROCS=4;
measured runtime GOMAXPROCS=2. B/C tags:
`with_gvisor,with_quic,with_utls,with_clash_api`.

B/C linker label is `1.14.0-alpha.0-experiment.93fff595`, explicitly a synthetic
label, not an upstream release tag. VCS identity and module graph are recorded.
Top-level source and go.mod/go.sum remained clean after the build:

- go.mod SHA-256: `c8a55d750ff56af8e097478b7ce88f10224f406041e73002ef89e4c8ade5769b`.
- go.sum SHA-256: `121265484ad99c79970266e5896eba82ff660c2921624225afa316e408f6d38e`.
- Full source/build/log/build-info: `/tmp/tono-stage-b-20260913/{sing-box,build-01}`.
- Small manifest: [raw/build.json](raw/build.json).

## Experimental topology and controls

```text
Owned client netns                         Owned server netns
request worker → real Linux TUN → core ──veth──→ sing-box Reality/Hy2 → owned HTTP
         198.18.0.1/30       10.203.0.2   10.203.0.1             203.0.113.10
```

Both namespaces are inside a new network/PID/mount namespace tree, without an
external NIC or default route. Host network settings are untouched. DNS query
endpoint `172.19.0.2:53` routes only into TUN. An owned DNS responder is at
`10.203.0.1:5300`. No public target receives workload traffic.

- CPU affinity: client core 0–1, server core 2–3, request worker 4–5,
  Python origin/TLS/DNS fixture 6–7. These are affinities, not exclusive host CPU reservations.
- TUN/veth MTU 1500. Manual namespace-only routes; no auto_redirect/firewall rules.
- Same server binary and synthetic credentials for all candidates within a run.
- Reality: exact local endpoint TCP/24443, `xtls-rprx-vision`, uTLS `chrome`,
  generated X25519 key/short ID and UUID, owned TLS 1.3 camouflage target, no public SNI.
- Hy2: UDP/24444, owned ECDSA CA/leaf, SNI `hy2.test`, 100 Mbps up/down on
  client and server (Hysteria/Brutal mode, not a BBR benchmark), no obfs/port hopping.
  sing-box Chrome QUIC parroting explicitly disabled. QUIC/library implementations
  still differ between A and B/C; no claim that every internal default is identical.
- Proxy multiplexing absent/disabled. Hy2's protocol-native QUIC streams are not
  additional proxy mux. One Hy2 session can carry multiple application requests.
- Warning-level logs; no profiling/race instrumentation in measured rounds.
- Per request maximum 32 MiB, deadline at most 10s. Per worker watchdog 45s;
  whole run root watchdog 240s + 2s kill grace. No case exceeds 60s by design.

The origin is Python and shares this host. Results cannot establish independent
server, public Internet, China carrier, sustained WAN throughput, or native UI behavior.
