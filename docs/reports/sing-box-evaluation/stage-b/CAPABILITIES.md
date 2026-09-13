# Environment permits isolated TUN; it does not permit controlled netem damage

Same Orb as [Stage A capability evidence](../CAPABILITIES.md): Debian 12,
Linux 6.1.158+, x86_64, 8 vCPU, approximately 16 GiB visible RAM,
14 GiB workload memory cgroup. Build toolchain Go1.27.1; Python3.11.6,
OpenSSL3.0.20. Disk had approximately 53 GB free at B start.

| Capability | Result | Executed evidence / scope |
|---|---|---|
| Fixed candidates | PASS | Candidate build exit 0; exact module lock and binary hashes verified. |
| Network/PID/mount namespace + veth | PASS | Each parity/measurement run creates a new tree and two linked netns; all routes/interfaces are inside it. |
| Real TUN TCP + UDP | PASS | Real application TCP via both transports; UDP and TCP DNS inside TUN; 738 verified payload samples. |
| Owned Reality/Hy2 services | PASS | Fixed sing-box inbound pair, locally generated identities/CA, owned TLS 1.3 target and HTTP/DNS services. |
| Netem | UNAVAILABLE | `zgrep CONFIG_NET_SCH_NETEM /proc/config.gz` exit 0: `# CONFIG_NET_SCH_NETEM is not set`. Stage A actual qdisc install failed. No controlled loss/jitter/RTT/bandwidth qdisc was applied. |
| UDP TUN offload | FAIL / fallback exercised | Both sing-box stacks log `set udp offload: TUNSETOFFLOAD: invalid argument`; normal packet I/O still passes. Do not claim this environment exercises all fast paths. |
| CPU usage / RSS / FD sampling | PASS | `/proc/<owned-pid>/stat`, status, fd, sampled every 50ms during load cases. CPU accounting granularity 100 ticks/s. Sampled peaks are not exact maxima. |
| Cgroup throttling / host steal | PASS | Read before/after; `nr_throttled=0`, `throttled_usec=0` delta. Host aggregate steal increases 12 ticks (0.12 CPU-s); no exclusive host reservation. |
| Packet capture | PASS in A; NOT_TESTED in B | No B pcap was needed for the narrow payload/route/controller checks. No claim about packet-level retransmission or zero loss. |
| CPU/heap/goroutine profiles | NOT_TESTED in B | Profile acquisition was shown in A only. B measured rounds deliberately have no profiling/race instrumentation. |
| Mutex/block contention | NOT_TESTED | Sampling not enabled; **no conclusion about absence of contention**. No copied runtime or patched candidate is used to fabricate profile data. |
| External authorized test nodes | NOT_TESTED | None used or requested. No production credentials or third-party load. |
| macOS PF / Windows WFP / native UI | UNAVAILABLE in this Linux Orb | Needs installed native devices, not container privilege or portable tests. |

## Containment and cleanup evidence

- The outer process takes host route/link/DNS snapshots before and after.
  All six B network invocations (five parity attempts, one measurement) report
  matching snapshots. No host default route, resolver or firewall is changed.
- No global process-name kill, iptables/nft flush, or named host netns mount.
  Interface names are scoped by the unique run's namespace tree and output ID.
- Root-owned `timeout 240s --kill-after=2s` encloses `unshare --net --pid
  --mount --mount-proc --fork --kill-child=SIGKILL`; cancellation is not treated
  as proof of resource release. Owned core PIDs are explicitly waited/reaped.
- Parent-timeout cleanup regression from A was rerun: 3/3 A harness tests pass,
  including actual root-owned namespace disappearance after parent timeout.
  Stage B harness tests: 4/4 pass in a new namespace (HTTP failure/deadline/body
  corruption, B/C configuration identity, empty-error gate failure, and export
  retention of failed/timeout samples in denominators).
- Post-run review found that **unprivileged `lsns` could omit root leftovers**.
  The final tool uses `sudo -n lsns`; this changes only post-run verification,
  not traffic generation. A fresh privileged inventory after all experiments
  showed only original namespace `4026531840`, PID 1 `/sbin/init`.
  [raw/artifacts.json](raw/artifacts.json) records this supplemental evidence.
  Do not treat the old unprivileged `cleanup.json` alone as sufficient proof.

The `network: missing default interface` log is expected for this sealed topology;
owned proxy endpoints are on a directly connected veth with explicit bind interface.
No default route was added to suppress it.

“No-loss” in this report means **no intentional impairment**. Interface counters
show zero TUN drops/errors, but that is not proof of zero QUIC/TCP retransmissions.
