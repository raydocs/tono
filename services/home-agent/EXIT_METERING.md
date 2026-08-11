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
needs it prints what the binary does offer and exits non-zero.

`test_reconcile_and_report.py` covers the arithmetic, because an error there costs
money in both directions and looks plausible either way. Each case was checked to
fail when the fold is broken: billing the reading instead of the delta charges
twice, and treating a restart as a decrease forgives everything used before it.

## What the exits need

Two things, neither of which the control plane can do from where it runs.

### 1. Expose the management API and per-account counters

The stack the node script installs today has neither: a single client with no
label, and no `api`/`stats`/`policy` sections. Counters are keyed by the account
label, so a client without one cannot be attributed — that is the whole reason
usage has never been recorded.

The inbound needs a client list rather than one client, `stats` enabled, per-user
uplink/downlink counters switched on in `policy`, and an `api` inbound bound to
localhost carrying `HandlerService` and `StatsService`, reachable at
`TONO_XRAY_API_ADDRESS`. Localhost only: that interface can add and remove
accounts.

### 2. Accept the issued identities

Each exit's inbound needs a client list rather than a single client, with the
account's identity as the client id and something stable as its label — the label
is what its statistics are keyed by, so it is the only thing that makes a counter
attributable.

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
- Reports are `{reportId, userId, totalBytes, observedAt}`, batched, at most 500
  per request and 100 distinct users.
- `totalBytes` is a **monotonic lifetime total per user**, not a delta. Rows are
  immutable and idempotent by `reportId`, so a replayed batch is safe and a
  counter that moves backwards is a bug to refuse rather than to smooth over.

The important consequence: proxy statistics reset when the process restarts, so
the meter must hold its own durable per-user totals and add deltas to them. The
existing reporter already does this, including replaying a batch that was
accepted but not acknowledged.

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
