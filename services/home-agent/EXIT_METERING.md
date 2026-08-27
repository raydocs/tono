# Exit-side metering

## Why this exists

`enforceAll` has always been ready to act on usage: it selects users whose
`usage_bytes` has passed `quota_bytes` and revokes them. The number it reads was
never going to arrive, because every account presented the same VLESS identity at
the exit. The exit could count bytes; it could not say whose.

The control plane now issues one identity per account. The remaining half is a
meter on each exit that reads per-identity counters and reports them.

## What the control plane now does

`GET /api/v1/exit-catalog` substitutes the requesting account's identity into the
published catalog:

- The published document carries `uuid: {{TONO_CLIENT_UUID}}`. Uploading a
  literal UUID is rejected with `INVALID_CATALOG`, so a shared credential cannot
  be re-published by accident.
- Each account's identity is minted on first fetch and stored in
  `exit_credentials`, one row per user, unique across users, deleted with the
  user. Stable across fetches, because the client persists the catalog digest and
  compares it — a fresh identity per request would read as tampering every time.
- The digest is recomputed over what was served, not over the template.

A catalog published before this change carries literals and is still served
unchanged. That is deliberate: refusing it would take every existing client
offline the moment it deploys. Re-publish with the placeholder to drain it.

## The agent

`services/exit-agent/reconcile_and_report.py` does both jobs on one timer. It
pulls, so an exit needs no inbound path and the control plane holds no per-exit
credential — and a Worker could not reach a private management API anyway.

    TONO_API_BASE=https://api.afk.ccwu.cc \
    TONO_HOME_AGENT_TOKEN=… \
    TONO_XRAY_BINARY=/opt/tono-xray/current/xray \
    TONO_XRAY_API_ADDRESS=127.0.0.1:10085 \
    TONO_XRAY_INBOUND_TAG=tono-vless \
    TONO_AGENT_STATE=/var/lib/tono-exit-agent/state.json \
      ./reconcile_and_report.py

It asks the binary which `api` subcommands it has rather than assuming: the names
differ between versions, and a wrong guess fails by doing nothing, which is
indistinguishable from a working meter reporting zero. When it cannot find what it
needs it prints what the binary does offer and exits non-zero. `inbounduser` is
the exception: it is looked up and lived without, because it is what makes a
removal safe rather than what makes the agent work.

`TONO_EXIT_SOURCE_ID` overrides the name this exit reports under. It is otherwise
`<hostname>-<machine-id>`, and kept in the state file. The hostname leads because
these nodes come from cloned images and a clone carries the source image's
`/etc/machine-id`: two exits presenting one name read each other's lower figures
as counter resets, and the account's total runs away. Set the override on any node
whose hostname and machine-id are both shared with another.

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

It is additive and idempotent. The credential every current client holds is kept,
so the fleet keeps working while accounts migrate to their own; a node that is
already metered is detected and left alone without a restart.

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
account's identity as the client id and something stable as its label — the label
is what its statistics are keyed by, so it is the only thing that makes a counter
attributable.

The label is `u:<userId>`. The control plane issues that form, the fleet audit
counts it, and the agent writes it: three names for one thing is how a node ends
up holding a duplicate of every account, and how usage lands under a label nobody
else is looking for. The namespace also says whose a client is — `shared-legacy`
and anything added by hand are outside it and are never removed.

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

- `POST /api/v1/home/usage` with `HOME_AGENT_TOKEN`.
- Reports are `{reportId, userId, sourceId, totalBytes, observedAt}`, batched, at
  most 500 per request and 100 distinct users.
- `totalBytes` is a **monotonic lifetime total per user and per source**, not a
  delta. Rows are immutable and idempotent by `reportId`, so a replayed batch is
  safe.
- `sourceId` names the reporter. The server keeps one cumulative figure per
  (user, source) and **adds them up**: with one meter per exit, folding them with
  MAX would bill an account for its largest exit rather than for what it used —
  an account spread over three nodes was counted at roughly a third of it, so
  enforcement never fired. It must therefore be stable for the life of the node;
  a new name is a new counter starting at zero, and the old one keeps whatever it
  had.
- Within one source a figure that moves **backwards** is a rebuilt node, and its
  accumulated total carries the pre-reset amount forward. Under MAX a rebuilt
  node reported a no-op every cycle until its local counter caught up with the
  fleet-wide figure, while the agent printed a successful report the whole time.
- A report with no `sourceId` lands in a single legacy source and keeps MAX,
  which is what the collector and any un-upgraded agent are already accounted
  under. That is deliberate: the collector's figure is an aggregate over a
  changing set of nodes, so it falls when a node leaves the fleet, and reading
  that fall as a reset would bill the account for its history twice.

**Do not run the collector and the per-exit agents against the same accounts.**
Each is a source of its own, and the sum counts both — the collector's SSH sweep
already includes the bytes the exit is now reporting for itself. Retire the
collector's usage sweep as the agents are rolled out.

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
