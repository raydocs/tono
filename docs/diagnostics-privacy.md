# Automatic diagnostics

Clients upload failure and session facts without a support request. This is the
channel that stays on. It is not the raw network log.

Raw logs (`POST /api/v1/diagnostics/logs`) still contain hostnames and process
paths. Migration `0036` keeps them behind `diagnostics_log_access`: an operator
must open a short window for one device. Do not auto-grant that window, and do
not treat `{ stored: false, reason: "not_enabled" }` as a reason to drop the
privacy-safe channel below.

## Why the snapshot was off

Commit `a68d4e76` (2026-09-03) defaulted periodic telemetry off and forced
previously-on installs off once (`periodic_telemetry_default_v2`). The comment
in the Windows client says a short timeline still writes durable D1 rows, so it
required an opt-in. Release-build connect failures (`POST /api/v1/telemetry/failures`)
follow that switch. Internal builds report a classified failure by default
(owner decision 2026-09-24, PR #580). Crash reporting is a separate switch and
defaults on, but the crash annotation rides the same snapshot; with the snapshot
off, the crash never leaves the device.

The privacy-safe upload does not include websites, URLs, or traffic contents.
That is why it is on by default. A client that records an explicit user choice
after the v2 force-off keeps that choice.

## Tables

| Table | What it stores | What it refuses |
|---|---|---|
| `connection_events` | kind, stage, code, node, timings, app/OS/core version, build, git commit, channel, directional `bytes_up` / `bytes_down` | hostnames, URLs, emails |
| `client_sessions` | one session per account (`{userId}:{sessionId}`), entry node id, residential exit id, bytes, outcome | credentials, full IPs, arbitrary log excerpts |
| `chain_hops` | hop index, role `entry` or `residential`, connected, handshake ms, failure code | SOCKS passwords, hostnames |
| `session_exit_observations` | IPv4 `/24` prefix, SHA-256 `ip_hash`, ASN, country, city, residential or datacenter, previous ASN/geo | a full IP address |
| `dns_checks` | resolver `system` / `tunnel` / `unknown`, leak and geo-mismatch flags, fake-ip or real-ip, IPv6 leak, resolver and exit ASN/country | queried domains |
| `ai_service_routes` | allowlist `claude` or `openai` only, exit kind, routing-leak and exit-switch flags, DNS and timezone mismatch flags, client version | paths, cookies, tokens, any other host |
| `failure_clusters` | one open row per outage key, counts, affected users and devices, first/last seen, redacted sample | emails, hostnames, full IPs |
| `customer_activity_hours` | online minutes and, on the last overlapped hour of a window, the window's byte totals | per-site bytes |

`v_failure_by_version` groups failure kinds by app version, build, channel, platform, and core version. `v_user_diagnostics` is the session rollup. Neither view joins `users.email`.

The optional `logExcerpt` field retains its type, length, URL and session checks
for compatibility, but automatic intake stores `log_excerpt` as null. Regex
scrubbing cannot establish that arbitrary log text contains no destinations or
credentials. Earlier stored excerpts remain subject to the existing retention.

Retention: diagnostics rows 90 days, `ai_service_routes` 60 days, deleted by the housekeeping cron. AI rows are rejected unless `aiServicesConsent` is true.

Bytes: directional `bytesUp` / `bytesDown` on telemetry events are copied onto `connection_events`. Activity hours add that total once, on the last hour the window overlaps. If the client sent only `bytesByRoute`, the combined total is stored as download so it is not added twice.

Ops console operators with Cloudflare Access read `GET /api/v1/ops/customers/{id}/diagnostics` (`customers.read`). That route is not the bot API.

## Engineering webhook

Unset `FAILURE_ALERT_WEBHOOK_URL` or `FAILURE_ALERT_WEBHOOK_SECRET` disables the send. The secret must be at least 32 characters. The URL must be `https` with no userinfo and must not target localhost, link-local, private, or metadata hosts. This is separate from the human alert allowlist in `src/ops/alerts.ts`.

The outage key is SHA-256 of `code`, `stage`, `appVersion`, `platform`, and node/exit, joined by newlines. The first event opens a cluster and sends `opened`. Further events join it. After 30 minutes without an event the open row becomes `quiet`, and the next event opens a new cluster. A `spike` send requires the count to reach at least 5× the count at the last alert and at least 10 events above that count, and at least 15 minutes since the last send. At most 12 webhook calls are made per hour.

`POST` body, `Content-Type: application/json`. Headers: `X-Tono-Timestamp` (unix seconds) and `X-Tono-Signature: sha256=<hex HMAC-SHA256 of "{timestamp}.{rawBody}">` using the webhook secret.

```json
{
  "schemaVersion": 1,
  "kind": "failure_cluster",
  "severity": "normal",
  "reason": "opened",
  "cluster": {
    "id": "uuid",
    "code": "timeout",
    "stage": "handshake",
    "appVersion": "0.0.74",
    "platform": "macos",
    "node": "Tokyo",
    "count": 1,
    "users": 1,
    "devices": 1,
    "firstSeenMs": 0,
    "lastSeenMs": 0,
    "sample": {
      "error": "dial failed for [redacted]",
      "appBuild": "74",
      "gitCommit": "abc",
      "coreVersion": "1.8.0",
      "channel": "release"
    }
  },
  "detailPath": "/api/v1/diagnostics/clusters/<id>"
}
```

`reason` is `opened` or `spike`. `severity` is `p0` or `normal`. `p0` is a network-loss code (`TONO_NETWORK_LOSS`, `TONO_FAIL_OPEN`, `TONO_WATCHDOG_RESTORE`, `TONO_KILL_SWITCH_STUCK`, `TONO_RESTORE_NETWORK`, `TONO_CRASH_WHILE_PROTECTED`): the webhook fires on the first event of that cluster and is not held for a spike or the hourly cap. `sample.error` is passed through the job redactor (emails, IPv4, UUIDs, passwords) and clipped. `sample` may be null.

## Read API

`DIAGNOSTICS_READ_TOKEN` (at least 32 characters) authenticates:

- `GET /api/v1/diagnostics/clusters?from=<unix seconds>&to=<unix seconds>` — clusters whose lifetime overlaps the window. Default is the last 24 hours. The window cannot exceed 7 days.
- `GET /api/v1/diagnostics/clusters/:id` — cluster, member ids, recent sessions, DNS checks, chain hops, and exit observations (`ipPrefix` only, never a full address).

Any other method on that prefix is `405`. A missing token configuration is `503`. A wrong bearer, including a user JWT, is `401`. The token cannot write and is not an Access admin session. Responses set `cache-control: no-store` and do not include email addresses.
