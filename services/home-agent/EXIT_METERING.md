# Exit-side metering

## Why this exists

`enforceAll` has always been ready to act on usage: it selects users whose
`usage_bytes` has passed `quota_bytes` and revokes them. The number it reads was
never going to arrive, because every account presented the same VLESS identity at
the exit. The exit could count bytes; it could not say whose.

The control plane now issues one identity per device. The remaining half is a
meter on each exit that reads per-identity counters, aggregates sibling devices
back to the owning account, and reports one monotonic total per account and exit.

## What the control plane now does

`GET /api/v1/exit-catalog` substitutes the requesting device's identity into the
published catalog:

- The published document carries `uuid: {{TONO_CLIENT_UUID}}`. Uploading a
  literal UUID is rejected with `INVALID_CATALOG`, so a shared credential cannot
  be re-published by accident.
- Each device's identity is stored in `device_exit_credentials`, unique across
  devices and deleted in the same transaction that revokes or LRU-evicts that
  device. It is stable across fetches because the client persists the catalog
  digest and compares it — a fresh identity per request would read as tampering
  every time.
- Migration starts in `dual`: exits receive both device identities and the
  legacy per-user identity, and catalogs may continue serving the legacy value
  until every active exit has acknowledged the current roster. An operator may
  advance to `device_only` only after that readiness gate passes. Only then is
  revoking one device an absolute data-plane cutoff; do not describe `dual` as
  providing that guarantee.
- The digest is recomputed over what was served, not over the template.

A catalog published before this change carries literals and is still served
unchanged. That is deliberate: refusing it would take every existing client
offline the moment it deploys. Re-publish with the placeholder to drain it.

## The agent

`services/exit-agent/reconcile_and_report.py` does both jobs on one timer. It
pulls, so an exit needs no inbound path and a Worker does not need access to its
private management API. Each exit uses a revocable node-specific bearer token;
the control plane stores only its SHA-256 hash.

    TONO_API_BASE=https://api.afk.ccwu.cc \
    TONO_HOME_AGENT_TOKEN=<node-specific-token> \
    TONO_SOURCE_ID=<existing-durable-source-id> \
    TONO_XRAY_BINARY=/opt/tono-xray/current/xray \
    TONO_XRAY_API_ADDRESS=127.0.0.1:10085 \
    TONO_XRAY_INBOUND_TAG=tono-vless \
    TONO_AGENT_STATE=/var/lib/tono-exit-agent/state.json \
      ./reconcile_and_report.py

It asks the binary which `api` subcommands it has rather than assuming: the names
differ between versions, and a wrong guess fails by doing nothing, which is
indistinguishable from a working meter reporting zero. When it cannot find what it
needs it prints what the binary does offer and exits non-zero. `inbounduser` is
the exception: a node with a durable prior inventory can temporarily reconcile
from that record, but a fresh node without either source refuses to ACK. Additions
alone cannot prove an old generation or `shared-legacy` credential was removed.

`TONO_SOURCE_ID` is an immutable accounting identity. On an existing node, first
flush its old `pendingReports`, stop the reporter timer, back up its state file,
and read the persisted `sourceId`. Provision the control-plane exit node with
that exact value, then configure the node-specific token and the same
`TONO_SOURCE_ID`. The roster echoes the token-bound `nodeId`; the agent compares
all three before changing Xray or billing state. Never rename this value or
delete the state file during rollout: an old cumulative report may already have
reached the old ledger, so moving it can either bill history twice or discard
unconfirmed usage. Use `services/exit-agent/exit-agent.env.example` as the
deployment template.

The current agent sends `protocolVersion: 2` and derives `observedAt` from the
authenticated roster clock rather than the node wall clock. The control plane
accepts a final queued v1 cumulative increase during upgrade, uses the first v2
report to replace the old time watermark, and never lets v1 move that source
again. After this cutover, a report replayed after ID retention is stale by the
durable per-source v2 watermark and cannot be billed again.

`test_reconcile_and_report.py` covers the arithmetic, because an error there costs
money in both directions and looks plausible either way. Each case was checked to
fail when the fold is broken: billing the reading instead of the delta charges
twice, and treating a restart as a decrease forgives everything used before it.
It also covers the labels and the delivery queue, where the cost is a disconnected
customer rather than a wrong number.

## What the exits need

Two things, neither of which the control plane can do from where it runs.

### 1. Expose the management API and per-account counters

The stack the node script installs today has neither: a single client with no
label, and no `api`/`stats`/`policy` sections. Counters are keyed by the account
label, so a client without one cannot be attributed — that is the whole reason
usage has never been recorded.

`tooling/scripts/remote/enable-tono-exit-metering.sh` does this. Copy it and
`exit_metering_config.py` to the exit and run as root:

    sudo ./enable-tono-exit-metering.sh

It is additive and idempotent. The initial shared credential is kept during the
`dual` rollout so the fleet keeps working while devices migrate. The reconciler
removes `shared-legacy` only after the control plane sends
`retireSharedLegacy: true` in `device_only`; a node that is already metered is
detected and left alone without a restart.

**One disconnection per exit, once.** Adding the management interface needs a
restart, because the interface it would otherwise be added through does not exist
yet. Run it one node at a time and let clients reconnect between them.

It validates the generated configuration with the installed xray before replacing
anything, keeps the previous configuration, puts it back if the service fails to
start or does not stay running, and finally checks that the management API
actually answers — configured-but-unreachable would otherwise surface later as an
agent reporting nothing, which reads identically to an exit with no accounts on
it.

`test_exit_metering_config.py` covers the edit. The two cases worth the most:
replacing the existing client instead of keeping it disconnects the whole fleet,
and reporting work to do when there is none spends a restart to discover that.
Both were checked to fail when broken, along with the API binding to a routable
address — that interface can issue identities.

### 2. Accept the issued identities

Each exit's inbound needs a client list rather than a single client, with the
device's identity as the client id and a stable device label — the label is what
its statistics are keyed by, so it is the only thing that makes a counter
attributable.

Device labels are `u:<userId>:<deviceId>:<credentialDigest>`; including a SHA-256
generation digest prevents a newly issued UUID for the same device from being
mistaken for the still-installed old UUID without putting the credential itself
in a metric label. A legacy per-user row in `dual` remains
`u:<userId>`. The agent recognizes both, sums every device, generation, and
legacy counter for the same user into one report, and reconciles the exact labels
derived from the control-plane roster. It removes an obsolete generation before
adding its replacement so Xray cannot reject the new binding as a duplicate and
then leave the device offline. The namespace also says whose a client is.
Hand-added entries are outside it and are never removed; `shared-legacy` is
removed only when the rollout signal (or an explicit
`TONO_RETIRE_SHARED_LEGACY=true` override) permits it.

Removal runs off what the inbound holds (`xray api inbounduser`), or failing that
off the labels the agent recorded installing. Never off the counters: a counter is
created on first connect and outlives the client, so it lists accounts that left
and omits ones just added. Driving removal from it revokes live customers. When
neither source is available the agent removes nothing and says so.

Clients added over the management API do not reach `config.json`, so a restart
drops all of them and the agent re-adds them on its next run. One consequence is
worth knowing during the cutover: a node that already holds bare-`userId` clients
from an earlier agent keeps them until it restarts, because they are outside the
namespace. They carry no traffic once the prefixed client for the same identity is
installed, and `xray api inbounduser` shows which nodes still have them.

Provisioning is a push: when an identity is issued, add it; when a user is
revoked or deleted, remove it. `xray` exposes this over its API
(`HandlerService` AddUser/RemoveUser) so it does not require a restart, and
restarting an exit to add an account would drop every live session on it.

**Removal is the enforcement path.** Quota enforcement that only stops counting
does not stop traffic; withdrawing the identity does.

### 3. Report counters

The agent implements this; the contract below is what it obeys, and it is the same
one `report_example.py` already obeys — there is deliberately only one:

- `POST /api/v1/home/usage` with the node-specific token in
  `TONO_HOME_AGENT_TOKEN`. The same token reads the roster, acknowledges a
  successful reconciliation at `POST /api/v1/home/roster-ack`, and separately
  acknowledges metering readiness at `POST /api/v1/home/metering-ack` with the
  exact body `{meteringProtocolVersion: 2, observedAt}`.
- Reports are
  `{reportId, userId, sourceId, protocolVersion: 2, totalBytes, observedAt}`,
  batched, at most 500 per request and 100 distinct users. `observedAt` comes
  from an authenticated control-plane response and advances monotonically in
  durable agent state, never from the node's wall clock.
- `totalBytes` is a **monotonic lifetime total per user and per source**, not a
  delta. Protocol-v2 replays are idempotent by the authenticated source's
  durable monotonic `observedAt` watermark, so they are safe without inserting
  and later deleting a D1 row per report. Legacy v1 keeps immutable report-ID
  rows during migration.
- `/home/inventory` returns the authenticated node's source-local cumulative
  watermark separately from account-wide usage. A reporter must recover from
  that source-local value; using the account-wide SUM as every node's baseline
  duplicates history and overbills multi-exit accounts.
- `sourceId` names the reporter. The server keeps one cumulative figure per
  (user, source). During the metering `dual` phase, accounts that already have a
  legacy empty source continue to bill from that source and named rows are
  shadow state; accounts with no legacy row bill from the sum of named sources.
  At the explicit `v2_required` cutover the control plane snapshots both the
  current account authority and named sum, then adds only subsequent named
  growth. This avoids counting the collector and per-exit view of the same bytes
  twice. It also avoids folding named exits with MAX, which would bill only the
  largest exit. A source ID must remain stable for the life of the node; a new
  name is a new counter starting at zero.
- Within one source a figure that moves **backwards** is a rebuilt node, and its
  accumulated total carries the pre-reset amount forward. Under MAX a rebuilt
  node reported a no-op every cycle until its local counter caught up with the
  fleet-wide figure, while the agent printed a successful report the whole time.
- A report with no `sourceId` lands in a single legacy source and keeps MAX,
  which is what the collector and any un-upgraded agent are already accounted
  under. That is deliberate: the collector's figure is an aggregate over a
  changing set of nodes, so it falls when a node leaves the fleet, and reading
  that fall as a reset would bill the account for its history twice.

## Metering-v2 cutover

Migration `0036` starts in `dual`; nothing activates cutover automatically. The
legacy collector remains authoritative for every account with an empty source,
while named agents build shadow watermarks. The administrative API is shared by
the Access-authenticated ops surface and token-authenticated automation:

```http
GET  /api/v1/ops/usage-metering-rollout
GET  /api/v1/admin/usage-metering-rollout
POST /api/v1/ops/usage-metering-rollout
POST /api/v1/admin/usage-metering-rollout
Content-Type: application/json

{"phase":"v2_required"}
```

The GET response separates legacy and named source/user/byte totals, lists every
active exit and whether its agent acknowledged protocol v2 recently, reports the last legacy
request, and includes `canRequireV2` plus machine-readable `blockers`. Advance in
this order:

**Rollout deferred:** publishing this code does not authorize starting new
metering collection or advancing to `v2_required`. Keep the current collection
and rollout state unchanged until a separate operational decision.

**Known live-cutover accounting gap:** named growth observed after the final
legacy report but before the cutover snapshot is absorbed into the baseline and
is not billed. The mandatory 1,800-second legacy quiet period can therefore
cause a permanent undercount while traffic continues. `canRequireV2` proves
protocol readiness, not lossless coverage. Do not execute the sequence below as
a lossless live migration: first establish a coordinated frozen traffic boundary,
implement a continuous accounting handoff, or explicitly accept a one-time
write-off. None of those operational actions is performed by shipping this code.

1. Apply migration `0036`, deploy the matching Worker, and verify GET reports
   `phase: "dual"`. Do not start named agents against an older Worker: the old
   sum would count overlapping legacy and named totals twice.
2. Start each node-specific agent without stopping the legacy collector. Wait
   for every active exit to acknowledge metering protocol v2 in the last 15
   minutes until each is `v2Ready: true`; the timestamp is the recent
   authenticated inventory observation, not receipt time. Duplicate observations
   do not renew readiness. An idle or empty exit sends the metering ACK after a
   valid counter read and durable save, without fabricating a zero-byte report.
   Compare named source IDs to the provisioned `exit_nodes.id` values and inspect
   quota headroom; an omitted source is rejected as `SOURCE_ID_REQUIRED` and a
   mismatch as `SOURCE_ID_MISMATCH`.
3. Stop only the collector's usage submission. Keep its roster/quality jobs if
   they are still needed. Wait until GET shows at least 1,800 seconds since
   `legacyLastSeenAt`; this is two observed 15-minute production cadences. An
   unchanged collector poll still refreshes this coarse liveness row, but no
   longer rewrites every account watermark or stores a useless report ID.
4. Require `canRequireV2: true` with no blockers. Save the GET response and a
   per-user comparison of `users.usage_reported_bytes`, legacy totals, and named
   totals for the change record.
5. POST `{"phase":"v2_required"}` once. The transaction snapshots every user's
   current authority and named sum before changing phase. Repeating the POST is
   idempotent. Afterward the collector endpoint and named v1 reports return
   `409 METERING_V2_REQUIRED`; named v2 growth remains monotonic and quota checks
   remain immediate.

There is deliberately no automatic rollback to `dual`: accepting the collector
again after post-cutover named growth would combine two accounting epochs. If a
node fails after cutover, repair or disable that named node rather than restarting
legacy usage ingest. Database triggers repeat the readiness and protocol checks
at the write boundary, so a concurrent final legacy batch is ordered wholly
before the baseline or rejected wholly after it.

**Accounts that were undercounted will now count.** Nothing about quotas or
`enforceAll` changed, but the number it reads is no longer a fraction of what an
account used, so it can begin acting on accounts it never acted on. Review
`usage_bytes` against `quota_bytes` before rolling this out; `resetUsage` ends a
cycle for an account that should not be caught by the correction.

The important consequence: proxy statistics reset when the process restarts, so
the meter must hold its own durable per-user totals and add deltas to them. The
existing reporter already does this, including replaying a batch that was
accepted but not acknowledged. Delivery is queued: one request carries at most a
hundred accounts, progress is recorded after each one, and a batch the server
refuses outright is isolated and dropped rather than left to block every account
behind it. Nothing is lost by that — the figure is cumulative, so the account's
next report carries those bytes again.

## What is deliberately not metered

The residential hop keeps shared credentials, so traffic through it is not
attributable per account. That is a considered trade: measured over a real
session, assistant traffic is on the order of a megabyte while the tunnel carried
tens of megabytes, so the bytes that matter for billing are all on the metered
path.

One consequence is worth stating rather than discovering later. Traffic reaches
the residential hop by matching Tono's own rules, including a process-path rule,
so a binary placed at a matching path is routed there. Unattributable and
unmetered, that is invisible. If the residential hop is ever the scarce resource
— it is a single static address — meter it **in aggregate** so saturation is
visible even though it cannot be attributed.

## Client-reported usage is not this

The client can report per-path byte counts from the core's own connection
accounting, and that is the only place the direct/tunnel/home split is visible at
all. It is also self-reported, so it must never reach `usage_reports`:
that table feeds `usage_bytes`, and `usage_bytes` feeds quota enforcement. Mixing
a falsifiable source into it hands quota to the client. If it is built, it belongs
in its own table, separated at the schema so nobody has to remember the reason.
