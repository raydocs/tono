# Restricted Stage B tools

Read the [Stage B report](../../../../docs/reports/sing-box-evaluation/stage-b/RESULTS.md)
and [parity scope](../../../../docs/reports/sing-box-evaluation/stage-b/PARITY.md)
before interpreting any numbers. These tools are not a Tono client or policy
adapter. They never install a product core or invoke the blocked Linux Service.
Only explicitly authorized experiments belong here.

## Fixed build, no dependency updates

Prerequisites: Linux namespace/TUN/veth permissions, passwordless scoped sudo,
`ip`, `ss`, `nsenter`, `unshare`, `timeout`, `taskset`, Python3.11+, OpenSSL, Git,
and exactly Go1.27.1. This run needs affinity CPUs 0–7; it does not resize an Orb.
The exact compiler installation instructions are in the parent Stage A README.

```sh
set -eu
scratch=$(mktemp -d /tmp/tono-stage-b.XXXXXXXX)
go=/path/to/go1.27.1/bin/go
tools=tooling/experiments/sing-box-bench
mihomo_build=/tmp/tono-stage-a-20260913/build-02
mihomo="$mihomo_build/mihomo-tono-linux-amd64"
# Reuse the preserved A binary; never overwrite an existing build directory.
if [ ! -e "$mihomo_build" ]; then
  PYTHONDONTWRITEBYTECODE=1 python3 "$tools/build_baseline.py" \
    --go "$go" --output "$mihomo_build"
fi
printf '%s  %s\n' \
  c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4 \
  "$mihomo" | sha256sum --check -
git init -q "$scratch/sing-box"
git -C "$scratch/sing-box" fetch --depth=1 \
  https://github.com/SagerNet/sing-box.git \
  93fff5954390367dd456cad3cbd79be54f8b941f
git -C "$scratch/sing-box" checkout --detach FETCH_HEAD
PYTHONDONTWRITEBYTECODE=1 python3 "$tools/stage_b/build_candidate.py" \
  --go "$go" --source "$scratch/sing-box" --output "$scratch/sing-build"
```

Builds use fixed source/module versions, `GOTOOLCHAIN=local`, `-mod=readonly`,
and bounded build time. Candidate construction does not require a public test
server. Network workloads are **never concurrent with builds**.

The A binary's `go version -m` embeds the absolute local module replacement
`/tmp/tono-stage-a-20260913/build-02/sing-tun`, despite `-trimpath`. A fresh-machine
rebuild must use that original path to attempt byte-identical reproduction;
another directory can change its hash without changing the patch. Cross-machine
byte reproducibility was not tested. On any hash mismatch, stop and investigate;
do not relax the runner's identity guard or substitute stock Mihomo.

## Gate before measurement

Every output directory must be new and outside **all** Tono worktrees. Existing
evidence is never overwritten. The runner verifies the frozen binary hashes.
Synthetic credentials, CA and private configs are created mode 600 outside Git;
do not publish the entire output directory.

```sh
sing="$scratch/sing-build/sing-box-linux-amd64"
PYTHONDONTWRITEBYTECODE=1 python3 "$tools/stage_b/run.py" parity \
  --mihomo "$mihomo" --sing-box "$sing" --output "$scratch/parity"
# Proceed only when the previous command exits 0 with gate_passed=true.
PYTHONDONTWRITEBYTECODE=1 python3 "$tools/stage_b/run.py" measure \
  --mihomo "$mihomo" --sing-box "$sing" --parity "$scratch/parity/results.json" \
  --output "$scratch/measure"
PYTHONDONTWRITEBYTECODE=1 python3 "$tools/stage_b/summarize.py" \
  "$scratch/measure/results.json" "$scratch/export"
```

The measure command refuses a failed gate or changed runner/config/workload
hash. Run a **fresh parity check** with the final tool version rather than reuse
the archived parity-05 file: its runner predates the post-run `sudo lsns` correction.
The measured tool version is separately frozen in
[`d5e69746`](https://github.com/raydocs/tono/commit/d5e69746f89c566c69bcbdf63ee74a7cf77f1f71).

The gate is deliberately a functional **synthetic IP-workload** gate. It proves
TUN, both transports, simultaneous outbound chains, TLS/auth rejection, fake-IP
use, DNS over TCP/UDP, rule ordering, actual reload behavior, crash containment
and cleanup. TTL/cache/reload-stream/native protection semantics remain migration
gaps; see the report. No formal performance request does a DNS lookup.

## Bounds and interpretation

- Same fixed server binary, certificate, target, MTU and 100 Mbps Hy2 rate per run.
  B/C are one sing-box binary differing only in explicit `stack`.
- New client process/state per round. Serial order ABC/CAB/BCA; 738 requests,
  about 507 MiB maximum successful payload. No implicit retries by the workload.
  Engine-internal handshake attempts are not mislabeled as distinct app samples.
- Application deadlines ≤10s, worker deadline 45s, root run watchdog 240s+2s.
  Exit failures and timeouts remain in raw JSON and CSV denominators. No p99.
- Process-local CA trust only. No TLS bypass, host route/DNS/firewall edit,
  global kill, real user identity, production server or third-party load.
- Cleanup stops/reaps exact owned children. Namespace PID1 exit kills the tree;
  the root watchdog remains effective if the unprivileged parent disappears.
  Final privileged `lsns` and host network snapshots verify containment.
- `api`, `--inside` and `--host-ns` are internal runner plumbing, not public
  commands. Do not use them to drive a product controller.
- CPU/RSS/FD sampling is separate from application clocks but runs during load;
  it adds fixed measurement overhead. No mutex/block sampling, allocation/GC,
  detailed handshake hooks, pcap, race detector or profile round was run in B.
- The mixed case proves overlap, but has no identically paced solo control.
  It cannot establish the causal effect of adding bulk traffic. The throughput
  cap also prevents an uncapped capacity ranking.

## Harness tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tooling/experiments/sing-box-bench -p test_bench.py -v
sudo -n timeout --signal=TERM --kill-after=2s 15s \
  unshare --net --pid --mount --mount-proc --fork --kill-child=SIGKILL \
  sh -c '/usr/sbin/ip link set lo up; PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tooling/experiments/sing-box-bench/stage_b -p test_stage_b.py -v'
```

These test the harness and actual local socket behavior, not a copy of the Tono
connection FSM. Measured TUN runs are also kernel/harness evidence, not proof of
installed PF/WFP, native Connected, DIRECT leases or update handoff.
