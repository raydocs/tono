# 0.0.73 connection beta: latency and cancellation

Owner request, 2026-09-22: make a substantial connection/stability improvement,
aim for 30–50% faster connections, and retain AI residential chaining and domestic
DIRECT. This work serves SHIP_PLAN G1/G2. It does not close the device or release gates.

Base: [aeb4b5ad69330507fdeed70a4b263667b2619eda](https://github.com/raydocs/tono/commit/aeb4b5ad69330507fdeed70a4b263667b2619eda),
the combined native-updater source in [PR #283](https://github.com/raydocs/tono/pull/283).
Connection work is stacked above that branch, not silently based on `origin/main`.
Native update qualification remains governed by [UPDATE_INTEGRATION_V1](UPDATE_INTEGRATION_V1.md).

## Bounded implementation scope

| Confirmed source bottleneck | Change being integrated | Evidence required |
| --- | --- | --- |
| Windows protected DNS apply starts PowerShell/CIM/netsh on the connect path | Native `SetInterfaceDnsSettings` apply plus effective `GetAdaptersAddresses` readback; one bounded compatibility batch only after synchronous completion | Healthy native orchestration spawns no shell; partial/error/contradictory readback cannot report success; existing single-writer timeout and snapshot regressions retained |
| macOS `getaddrinfo` blocks inside a task-group timeout race; leaving the group drains the blocking child. DNS-SD submission itself can also synchronously block on the daemon | System DNS via DNSService API; independent waiter deadline/cancellation, serial C-ref ownership and one outstanding request claim | Both held submission and held callback release the caller on deadline/cancel; no stacked blocked submissions, late readiness or cross-queue deallocation |
| macOS final failed TUN probe is followed by another serial mixed-proxy diagnostic | Overlap the diagnostic with the final TUN round; cancel it on TUN success | Only real TUN proof grants Connected; diagnostic success cannot substitute; stale/cancelled work cannot write route preference or telemetry |

Native source and exact hosted regression results are recorded in the integration PR.
Until those results exist, the above is implementation scope, not a passed checklist.

The macOS setup distinction is important: Apple's DNS-SD client synchronously
submits the daemon request before installing dispatch callbacks. Its nominal daemon
acknowledgement wait is 60 seconds, and not every setup I/O has a wall-clock bound
([client stub, pinned source](https://github.com/apple-oss-distributions/mDNSResponder/blob/d4658af3f5f291311c6aee4210aa6d39bda82bbe/mDNSShared/dnssd_clientstub.c#L1153-L1158)).
A timer queued behind that C call does not bound Disconnect. The scoped repair
separates ending the caller's wait from eventual OS cleanup: deadline/cancellation
returns no DNS readiness, while the owner retains the one request claim until it
can dispose the ref. A synchronous OS call is **not forcibly canceled**; subsequent
requests fail closed rather than accumulate blocked workers. Native tests must
hold the submission call itself, not only withhold an already-registered callback.

Kept unchanged:

- AI routes retain the residential hop through the selected Tono exit, with no
  cloud-only or DIRECT fallback. Domestic app DIRECT selection/rule precedence stays.
- PF/WFP, TLS verification, exact adapter ownership and data-plane validation remain
  required. Faster is not achieved by declaring Connected earlier or hiding failures.
- Windows original DNS snapshot, restore/DHCP, NRPT/DoH and bounded writer ownership
  remain authoritative. Empty IPv6 API input is not proof of DHCP/reset semantics.
- macOS retains its existing gstatic/Cloudflare/Apple success criteria. This change
  does not replace them with the different Windows probe contract.
- No automatic transport/exit change, server provisioning, customer-channel update,
  runtime migration or new third-party dependency. Windows on this base still uses
  Mihomo; macOS uses sing-box. A separate migration is not assumed complete.

## Measure the same device, route and scenario

The read-only [comparison tool](../tooling/scripts/compare-connect-performance.mjs)
uses existing client `traffic-audit.jsonl` files. It does not alter network settings,
start connections, upload logs or collect new telemetry.

For each platform, capture baseline and candidate on the **same** device/network,
exit/transport, catalog and policy. Keep cold connect, warm reconnect, sleep/wake and
explicit cancellation in separate runs. Do not discard failed attempts. Record the
total attempt count independently of the JSONL, including automatic retries; logs
are best-effort and cannot reveal a whole attempt that never reached disk.

Copy each bounded capture to private local storage. Keep chronological JSONL order;
if a capture crosses rotation, concatenate only its captured generations oldest first.
Do not combine devices or partial sessions. No raw logs or private metadata belong
in Git or a public PR. A run manifest, relative to its log, has this shape:

```json
{
  "schemaVersion": 1,
  "sourceCommit": "FULL_LOWERCASE_40_CHARACTER_TESTED_SHA",
  "platform": "windows",
  "evidence": "native-device",
  "auditLog": "baseline.jsonl",
  "expectedAttempts": 25,
  "conditions": {
    "device": "private-stable-label",
    "network": "private-stable-label",
    "scenario": "warm-connect",
    "exit": "private-stable-label",
    "transport": "reality",
    "catalogDigest": "actual-catalog-digest",
    "policyDigest": "actual-policy-digest"
  },
  "checks": {
    "aiResidential": "not-run",
    "domesticDirect": "not-run",
    "failClosed": "not-run"
  }
}
```

Use `macos` for the other platform; `hosted` and `synthetic` evidence cannot establish
a native-device target. Set a routing/protection check to `passed` only after its
actual observation, not because the configuration looks right. Retain that evidence
separately: these labels and the source SHA are operator assertions, not authenticated
by the tool. Manifest size is capped at 64 KiB and each log at 32 MiB.

```sh
node tooling/scripts/compare-connect-performance.mjs /private/baseline.json /private/candidate.json
```

Output retains successful/failed/cancelled/incomplete counts, success rate, nearest-rank
P50/P95, per-stage time, source SHAs and log/condition SHA-256. It omits raw events,
account data, device/network labels, paths and error text. Windows successful timing
uses its monotonic `elapsedMs`; macOS uses queued audit wall-clock timestamps, which
are only an approximation and must not be described as a new monotonic benchmark.

The initial comparison rule requires at least 20 measured successes on each side,
matching independent attempt counts, no detected loss/inconsistent timeline, recorded
routing/protection checks and a nonregressing success rate. Both P50 and P95 must
improve by at least 30% before `observed30PercentTarget` is true; 50% is a stretch
target, not a cap. These are an explicit beta measurement choice, not statistical
confidence or a publication gate. Repeat in representative customer networks.

Missing evidence returns a null target result plus reasons. Exit 0 means the report
was computed, **not** that speed improved or release requirements passed. Comparison
tests use synthetic durations; they do not establish any product speedup.

## Remaining external evidence

No baseline/candidate device timing or 30–50% improvement has been measured in this
orb. Native compilation/regressions run through existing hosted macOS/Windows CI;
installed Windows 11/macOS DNS restoration, multi-adapter DHCP/RA behavior, sleep/wake,
AI residential egress, domestic DIRECT and packet-level fail-closed evidence still
need the bounded device lane in [BUILD_AND_TEST](BUILD_AND_TEST.md).

Connection latency is not download throughput or AI first-token latency. A claim
about those needs a separate same-route measurement. Do not replace residential
egress with a different route merely to produce a larger percentage.
