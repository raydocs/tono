# Tono Stage A experiment tools

These are Linux **experiment tools**, not Tono's privileged product runtime.
They never install into Resources/sidecar, modify product files, or exercise the
blocked Linux Service `StartClash` path. No Stage B runner or sing-box candidate is
implemented. See `docs/reports/sing-box-evaluation/` for the evidence and limits.

## Prerequisites

- Python 3.11+, Git, curl, Linux `ip`, `/usr/sbin/tc`, `unshare`, `timeout`, sudo.
- Namespace/root permission for the synthetic tests, `/dev/net/tun` for its probe.
- Optional tcpdump for the packet-capture capability row (missing is reported).
- Exactly Go **1.27.1** for the build. The builder uses `GOTOOLCHAIN=local` and never
  upgrades dependencies. Tool installation is separate from the builder.

Validated official Linux-amd64 toolchain archive:

```sh
scratch=$(mktemp -d /tmp/tono-stage-a.XXXXXXXX)
curl --fail --location --max-time 180 \
  https://go.dev/dl/go1.27.1.linux-amd64.tar.gz -o "$scratch/go.tar.gz"
printf '%s  %s\n' \
  63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445 \
  "$scratch/go.tar.gz" | sha256sum -c -
tar -xzf "$scratch/go.tar.gz" -C "$scratch"
```

Only run the following tests from the fixed experiment worktree. Output paths
must be new and outside **every** Tono worktree; reruns never overwrite evidence.

```sh
python3 tooling/experiments/sing-box-bench/build_baseline.py \
  --go "$scratch/go/bin/go" --output "$scratch/build"

python3 tooling/experiments/sing-box-bench/bench.py preflight \
  --output "$scratch/preflight"

python3 tooling/experiments/sing-box-bench/bench.py smoke \
  --binary "$scratch/build/mihomo-tono-linux-amd64" --output "$scratch/smoke"

python3 tooling/experiments/sing-box-bench/bench.py profiles \
  --binary "$scratch/build/mihomo-tono-linux-amd64" --output "$scratch/profiles"

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tooling/experiments/sing-box-bench -p test_bench.py -v
```

The tests include a real root-owned namespace timeout check; they require the
same sudo/unshare capabilities as preflight. A netem failure is a failed
capability row and a nonzero preflight result, not permission to alter the host.
Other rows continue. Do not chain all commands with `&&` if netem is unavailable.

## Scope, limits and cleanup

- Build pins the exact upstream commit and verifies both product identity JSONs
  and the patch against the fixed Tono Git baseline. The only upstream edit is
  the local module replacement pointing at the patched MetaCubeX sing-tun.
- Build commands are bounded to 600s apiece, compile parallelism 4. A failed
  identity/build writes `BASELINE_UNAVAILABLE`; never substitute stock/latest.
- Each network command creates new network/PID/mount namespaces, a private proc
  mount, and no external interface/default route. Inner execution refuses the
  original namespace and requires namespace PID 1. Do not invoke `--inside`.
- A root-owned watchdog runs 50s, then TERM and KILL after 2s; the outer timeout
  is 60s. This bounds root cleanup even if the unprivileged parent is interrupted.
  Normal cleanup stops and reaps only owned children; PID namespace exit destroys
  its processes, nonpersistent interfaces and routes. No global process matching.
- Host route/interface/DNS snapshots must match before and after. Configs/logs
  and namespace resources use a unique run ID or a unique new output directory.
- `smoke` is **SOCKS5→DIRECT→owned loopback HTTP**, NOT TUN performance and NOT
  Reality/Hy2. It has one warmup, 15 measured requests (3 batches in one process),
  and explicit 503/timeout controls. Each response is fixed-size, byte-verified,
  curl max-filesize bounded, with a 2s deadline (negative timeout: 100ms).
- The byte cap, concurrency 1, and tiny sample count intentionally preclude
  throughput/p99/candidate ranking. Client and server contend on the same host.
- TUN preflight performs real bidirectional kernel/fd UDP packet exchange using
  a synthetic responder. It is not a model of Tono's FSM or a Mihomo stack test.
- Profiles are a separate debug instance, capped at 4MiB each; normal performance
  samples use warning-level logs. Empty mutex/block profiles do not prove no
  contention. The idle CPU profile only verifies acquisition/parsing.
- `results.json`, `samples.csv`, `execution.json`, `host-network.json`, config,
  and bounded local logs remain in the supplied output directory. Preserve failed
  output; inspect `status` and `exit_code`, not just whether a file exists.
- SIGKILL may prevent the parent from writing final JSON. The root watchdog does
  not depend on final JSON for cleanup. Disappearing namespace/owned listeners,
  not cancellation acknowledgement, is the resource-release evidence.

Only synthetic controller authentication is used. No real node or user identity,
TLS bypass, production SSH, customer destination, or business request replay.
No pin/SNI is guessed to improve connectivity. Stage B requires explicit user
approval and an independently verified configuration/lifecycle contract.
