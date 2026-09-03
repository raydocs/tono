# Tono home usage agent

The Cloudflare Worker accepts monotonic usage reports at `POST /api/v1/home/usage`.
This directory is the Mac Studio side agent that attributes exit-node traffic to
Tono user IDs and reports totals.

## Status

Verified-public-key attribution is implemented and covered by local tests, but
it is not deployed. The Worker supplies a token-protected
`GET /api/v1/home/inventory` mapping containing the public key already matched
against server inventory during confirm. The reporter reads
`tailscale status --json`, attributes each peer's `RxBytes + TxBytes` by that
key, retains the actual status stable ID for reset continuity/audit, turns
counter resets into monotonic deltas, and durably reports per-user lifetime
totals. Quota enforcement on the Worker is real only after this service is
installed and validated on the exit node.

## Contract

```http
POST /api/v1/home/usage
Authorization: Bearer <node-specific-token>
Content-Type: application/json

{
  "reports": [
    {
      "reportId": "uuid-or-dedupe-key",
      "userId": "tono-user-id",
      "sourceId": "durable-exit-node-id",
      "protocolVersion": 2,
      "totalBytes": 123456789,
      "observedAt": 1710000000
    }
  ]
}
```

Rules:

- `HOME_AGENT_TOKEN` must contain the one-time token issued for the provisioned
  `exit_nodes` row named by `TONO_SOURCE_ID`. The shared Worker
  `HOME_AGENT_TOKEN` secret is read-only during the `dual` rollout and cannot
  submit usage.
- `sourceId` is the durable provisioned node ID and cannot change after the
  state file records it. The inventory response echoes the token-bound node ID;
  the reporter refuses a mismatch before reading local counters.
- `totalBytes` is a **monotonic lifetime total** per user and source, not a delta.
- Inventory recovery uses the authenticated node's `sourceUsageBytes`
  watermark, never the account-wide `usageBytes` sum. Seeding each exit from
  the account sum would make a second exit re-report the first exit's history.
  If that server watermark is ahead of local state, the recovery round records
  current peer counters as raw baselines without billing their ambiguous
  history; only deltas observed after that round are added.
- Protocol v2 uses the inventory response's server clock and a persisted
  strictly increasing watermark, not the Mac's wall clock.
- `reportId` identifies a queued delivery attempt. Protocol-v2 exactly-once
  behavior comes from the authenticated source and its durable monotonic
  `observedAt` watermark, so an exact replay is accepted without another D1
  write and a random ID collision on another node cannot suppress usage. Legacy
  v1 reports retain immutable ID rows and conflicting reuse returns
  `409 USAGE_REPORT_CONFLICT`.
- Out-of-order lower totals must not decrease `users.usage_bytes` (Worker uses `MAX`).
- Persist the complete pending batch before sending it. After a timeout or
  crash, retry that exact batch before generating any new report IDs.
- Keep state in a service-owned `0700` directory and a `0600` regular file.
- `TONO_API_BASE_URL` must be a bare HTTPS origin on port 443. Authenticated
  inventory and usage requests never follow redirects.
- Only one reporter may run against a state file at a time. The process lock
  covers recovery, counter observation, persistence, and delivery; an
  overlapping timer or operator run exits before reading counters.

## Deployment work remaining

1. Deploy the Worker version containing `/api/v1/home/inventory`, provision a
   unique `exit_nodes.id`, and save its one-time token.
2. Configure that ID as `TONO_SOURCE_ID`, put its node-specific token in the
   protected token file, and configure an absolute, protected `TAILSCALE_CLI`
   path that can read the
   Mac Studio daemon; set `TAILSCALE_SOCKET` only for a non-default LocalAPI
   socket.
3. Run every 10 minutes under launchd with a protected service identity and
   secret storage; add exponential retry scheduling around process invocations.
4. Generate traffic from two real Tono clients, verify peer/user attribution,
   then test daemon reset, revocation, and quota enforcement. The counters are
   encrypted Tailscale peer bytes (including protocol overhead), not an
   application-payload meter.

## Environment

```bash
export TONO_API_BASE_URL="https://api.example.com"
export TONO_SOURCE_ID="durable-exit-node-id"
export HOME_AGENT_TOKEN_FILE="/absolute/service-owned/mode-0600/token"
export STATE_PATH="/Library/Application Support/Tono/HomeAgent/state.json"
export TAILSCALE_CLI="/absolute/protected/path/to/tailscale"
# export TAILSCALE_SOCKET="/absolute/path/to/tailscaled.sock"
```

`HOME_AGENT_TOKEN` is accepted for local/manual testing, but a launchd service
should use the protected token-file path so the secret is not embedded in a
world-readable plist. The file contains the node-specific one-time token returned
when this `TONO_SOURCE_ID` was provisioned; it is not the Worker's shared
`HOME_AGENT_TOKEN` secret. Never commit it.

The reporter refuses ambiguous verified-key mappings, cross-user stable-ID
reuse, unsafe CLI paths, malformed/unbounded status, invalid counters, and
totals outside the safe-integer range. Its HTTPS-only delivery, no-redirect
behavior, response bounds, private atomic state, and exact-replay logic are
part of the contract.
