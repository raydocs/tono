# Metering #4 / #5: evidence and implementation boundary

Ops task: legacy-to-v2 metering handoff and counter-generation evidence; not a
customer-update publication gate. Review base:
[`a605306a`](https://github.com/raydocs/tono/commit/a605306a1d41b93035338bd44e58635b5659e7df).
This is a design/evidence delivery, not a new accounting protocol or deployment.

## Neither issue is resolved or a duplicate

- [#4](https://github.com/raydocs/tono/issues/4):
  [#8](https://github.com/raydocs/tono/pull/8) already supplied the API and atomic
  D1 safety fence (`0037_block_unpaired_legacy_cutover.sql`). Do not reimplement
  it. It prevents a lossy transition, not undercount while a stopped legacy
  collector remains authoritative. Keep the issue open and collection unchanged.
- [#5](https://github.com/raydocs/tono/issues/5): the Tailscale reporter still has
  only peer identity and numeric baselines. Xray's existing restart marker is a
  different implementation and does not close this issue. No supported-device
  generation evidence or historical billing repair is claimed.

## Trace the actual inputs, not their shared endpoint name

| Owner | Observation / transport | Current evidence |
|---|---|---|
| `services/exit-agent/reconcile_and_report.py` | Xray stats per credential label, aggregated to user; `/home/usage` v2 | Local process marker brackets reconciliation/read, restart folding, durable pending queue. Credential suffix is not a Tailscale peer epoch. |
| `services/home-agent/report_example.py` | `tailscale status --json`; verified public-key inventory maps peers to users; `/home/usage` v2 | Stable peer ID indexes `lastRawBytes`; numeric decrease adds the new raw count; equal/higher reset is invisible. Server-ahead recovery rebaselines rather than rebilling unproven history. |
| External legacy collector | `/ops-ingest/usage`, collector token, v1 only, no named `sourceId` | Worker receives account aggregates in source `''` and keeps MAX. Sender/aggregation/checkpoint source is not in this checkout. `ops-panel/collect.py` sends quality reports, not these usage requests. |
| Worker `src/index.ts` | `{reportId,userId,sourceId,protocolVersion,totalBytes,observedAt}` | Named source must equal authenticated node; v2 uses monotonic per-source observation watermark; v1 retains immutable IDs. Server observation time is freshness/replay evidence, not raw-counter generation or paired accounting evidence. |

`git grep -n 'ops-ingest/usage'` finds the receiving handler and tests, not a
sender. This proves a repository-source gap, not that no collector exists.
No SSH config or Tailscale executable was available in this orb; deployed
versions and production state were not newly inspected. The read-only production
report in #4 dated September 13 is prior evidence, not this review's live result.

## Counterexamples that the new protocol must distinguish

**Cutover:** legacy authority 1000 and paired named total 400 at the last covered
boundary; named total reaches 600 during silence and 650 later. Saving a cutover
baseline of 600 yields 1000 + (650 − 600) = 1050. The paired boundary gives
1000 + (650 − 400) = 1250. Current main rejects this legacy cutover; its existing
Worker/D1 regression also tests retry and rollback of an inserted baseline.

The same final database values L=1000/N=600 can also arise when all 600 named
bytes were covered by L. In that history 1050 is correct. Taking a smaller
baseline without paired observation evidence overbills that history. Quiet time,
MAX/SUM changes and matching receipt timestamps do not distinguish them.

**Reset:** persisted lifetime=1000/raw=1000, next same-ID/key raw=1500 can mean
500 bytes without reset or 1500 bytes after recreation. Correct lifetime is
respectively 1500 or 2500. The new Python witness calls the real attribution
function and exposes the missing 1000; its passing result is explicitly NOT
reset acceptance. An always-add algorithm instead overbills the no-reset case.
Even a proven reset to raw=1000 must add 1000, not zero; raw=200 adds 200 but
still cannot recover an unobserved pre-retirement tail.

## Source proof: a daemon marker is insufficient for Tailscale

Pinned upstream inspection (not a real-device experiment): Tailscale
[`5201273`](https://github.com/tailscale/tailscale/commit/5201273aec737d6372ab7423c31c04ca3ca2a0c2)
pins wireguard-go `24b5b6917431` in
[go.mod](https://github.com/tailscale/tailscale/blob/5201273aec737d6372ab7423c31c04ca3ca2a0c2/go.mod#L132).

- [Peer allocation and counters](https://github.com/tailscale/wireguard-go/blob/24b5b6917431/device/peer.go#L38-L151): atomics belong to a newly allocated `Peer`, not the durable node ID.
- [Lazy lookup/create](https://github.com/tailscale/wireguard-go/blob/24b5b6917431/device/device.go#L437-L481) and [idle removal](https://github.com/tailscale/wireguard-go/blob/24b5b6917431/device/timers.go#L127-L138): deletion/recreation can occur in the same daemon with the same key. PID/boot ID therefore misses resets.
- [Counter read and active-peer enumeration](https://github.com/tailscale/tailscale/blob/5201273aec737d6372ab7423c31c04ca3ca2a0c2/wgengine/userspace.go#L1004-L1075) and [public status](https://github.com/tailscale/tailscale/blob/5201273aec737d6372ab7423c31c04ca3ca2a0c2/ipn/ipnstate/ipnstate.go#L210-L285): no counter epoch or retired-peer total.
- [Transmit accounting](https://github.com/tailscale/wireguard-go/blob/24b5b6917431/device/peer.go#L183-L214) and [receive accounting](https://github.com/tailscale/wireguard-go/blob/24b5b6917431/device/receive.go#L450-L536): WireGuard transport bytes, not application payload/IP bytes. Handshake traffic can also count. Moving to nftables/tc changes the observation point and units.

These semantics must be checked against the actually deployed pinned version.
`Created`, handshake time, public key and process identity are not substitutes
for a counter-instance identity covering all reset paths.

## Proposed boundary; blocked until source and accounting policy are supplied

1. Keep `dual` and migration 0037. Obtain the real legacy aggregation source,
   deployed version, durable state format and source roster. Establish whether
   both legacy and named totals measure the same units and traffic coverage.
   Aggregate MAX history over a changing fleet is not itself that proof.
2. A durable handoff ID enters `preparing` with an immutable roster, versions,
   accounting units and attribution revision. Each source checkpoints an
   immutable receipt from the same observations that produce its legacy and
   named boundary values. Empty sources/users require explicit receipts too.
   Reporters keep queuing post-boundary growth; source churn blocks preparation
   unless explicitly represented. No operator-entered timestamp pairing.
3. Enter `paired` only when collector final authority L and per-source named N
   derive from the complete receipt set. Fence final/late legacy writes at the
   same durable boundary; a racing request must not escape via a preflight read.
   Lost receipts/retries use the same handoff ID; changed content conflicts.
4. Atomically commit boundary, phase, immediate reconciliation and audit.
   Reconcile L + sum(current named − paired N) per user, including quiet-window
   growth before another report arrives. Preserve account monotonicity and quota
   enforcement; reject negative/unexplained differences rather than clamping
   away missing history. New users/sources require explicit zero-history or
   carried-history receipts, not an implicit zero for a missing source.
5. Abort before commit can resume legacy authority only with a reconciled
   collector checkpoint/queued interval. After commit, no downgrade to legacy.
   Neither deleting watermarks nor reopening closed finance months repairs an
   unknown historical undercount. Any adjustment needs separately evidenced
   attribution, amount and approval; account byte quota and finance CNY ledger
   are different ledgers.

For #5, prefer a pinned counter-owner snapshot exposing **peer generation plus
accumulated retired-peer totals** and an atomic observation sequence. A generation
alone loses bytes between the last poll and retirement. The counter owner must
checkpoint retirement/replacement before resetting, and the reporter must persist
snapshot position, user totals and immutable queue together. Missing/changing
generation must not advance baselines or ACK readiness. Generation-less local
state or server-ahead recovery requires reconciliation; do not rebill current raw
counters as though history were empty. Replay queued reports before observing.

An instrumented daemon still cannot promise zero loss on power failure without
durable counter ownership. Specify durable accumulation or an explicit bounded
loss/unknown-state policy; do not silently approximate. Collector-owned kernel
counters are an alternative only after approval of IP-byte accounting, IP/roster
ownership transitions, rule-replacement checkpoints and crash-loss semantics.

Required integrated acceptance: 1250 cutover case and overlapping-history
countercase; multiple/new/missing sources and users; reset below/equal/above;
same-daemon recreation/idle eviction; restart during read; pending-report replay;
server-ahead/state loss; receipt conflict; late legacy requests; immediate quota
reconciliation and audit rollback. A mock that simply asserts L/N are paired is
not collector integration evidence. Supported-host restart/recreation tests
remain required before rollout; Mac Studio is no longer a residential exit.

## D1 / D3 / D5 WIP disposition

| Historical work | Current disposition |
|---|---|
| D1 [`cf347d3e`](https://github.com/raydocs/tono/commit/cf347d3ebe66e61b050c0a957d66d97e49aa8add), tip [`d95bd974`](https://github.com/raydocs/tono/commit/d95bd97464314f810f9714d25129b38137c72333) | Snapshot/CSV/fixture reversal behavior already absorbed via [`dfff6853`](https://github.com/raydocs/tono/commit/dfff6853). Main stores partial snapshot marker for oversized months and later integrates D2 reconciliation. Do not replace it with WIP NULL/empty reconciliation or duplicate migration 0069. `customer_activity_hours` allocation snapshots do not establish authoritative usage boundaries. |
| D1 current-month lock/reversal hints | Still useful, not yet absorbed. Current UTC target month being closed blocks reversals even from older months; existing UI promises “只能冲正”. Track [#191](https://github.com/raydocs/tono/issues/191), already opened during this review, not a duplicate new issue. Coordinate with [#186](https://github.com/raydocs/tono/pull/186); preserve readiness guards and resolve local-vs-UTC month. No UI change in this delivery. |
| D3 [`18cc8a7b`](https://github.com/raydocs/tono/commit/18cc8a7b989ac2eaff41770d37dd5244b7c00208), tip [`c3341418`](https://github.com/raydocs/tono/commit/c3341418ae13e658377718f6b0a8ce6d7003f51c) | Release object verification is already represented by main `releases-verify.ts` / [`4c90bed5`](https://github.com/raydocs/tono/commit/4c90bed5). WIP dynamic `releases-public.ts` feed activation is not a metering repair and must not be imported to satisfy #4/#5. No update-source promotion. |
| D5 [`1eefe244`](https://github.com/raydocs/tono/commit/1eefe244f7237d79d54db030e7cbadf1ae1c131b), tip [`b7d8eaf8`](https://github.com/raydocs/tono/commit/b7d8eaf8c59e9a2c420f04c4a3fe3e01f990b2f4) | Main routes `weeklyWorthwhile` to `weekly-picks.ts` via [`a4eef1b5`](https://github.com/raydocs/tono/commit/a4eef1b5), not the stale stub comment. WIP has a different generator/ranking implementation; estimates and month-unclosed recommendations are not authoritative metering. No wholesale cherry-pick. |

WIP tips also carry D4 ancestry whose equivalent work already landed. Branch
non-ancestry does not establish missing behavior. No branches deleted or issues
#4/#5 closed. #191 owns the remaining actionable UI gap.

## Reproduce in a Linux orb

No production token, SSH mutation, remote D1, native build or deployment needed:

```sh
python3 services/home-agent/test_report_example.py
cd services/control-plane
npx vitest run test/worker.test.ts -t 'blocks unpaired legacy cutover|exposes readiness and permits explicit v2 cutover'
npx vitest run test/ops-ledger.test.ts -t 'serves frozen totals|rejects reverse when the current month is closed'
```

The Python test is a known-defect witness; Worker tests verify the existing
safety fence and no-legacy transition; ledger tests verify the already absorbed
freeze/lock behavior. None proves the proposed handoff or native generation
protocol. Execution results and exact delivered SHA belong in the PR.
