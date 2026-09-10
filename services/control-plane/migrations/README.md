# D1 migrations

Wrangler records each file name in `d1_migrations`. Applied files must keep
their current names; renaming looks like a new migration and a missing old
one.

## Colliding numeric prefixes

Three prefixes were reused before the sequence became unique at `0019`.
Each file is a distinct applied migration. Lexical order within a prefix
is the apply order:

| Prefix | Files (apply order) |
| --- | --- |
| `0016` | `0016_exit_credentials.sql`, `0016_operations_read_model.sql`, `0016_routing_research_snapshots.sql` |
| `0017` | `0017_expand_routing_research_payload.sql`, `0017_user_home_catalog_bindings.sql` |
| `0018` | `0018_periodic_telemetry_windows.sql`, `0018_traffic_policy_signature.sql`, `0018_user_default_proxy.sql` |

Do not collapse, renumber, or rewrite these to “fix” the prefixes. New
schema changes continue from the highest existing number (`0056` at the
time this note was written).

## 0039–0056

Ops tables after the sequence was unique. Applied in numeric order:

- `0039_ops_connection_events.sql` — flattened connection events, flatten cursor, daily rollup
- `0040_ops_verdicts_and_incidents.sql` — node verdicts, status history, incidents
- `0041_ops_alerts.sql` — alert rules, cooldown state, delivery outbox
- `0042_ops_node_jobs.sql` — operator-asked node jobs
- `0043_client_releases.sql` — client release registry and version-adoption rollup
- `0044_ops_customer_projections.sql` — customer status, activity hours, sessions
- `0045_ops_traffic_destinations.sql` — destination/service-family rollups and direct candidates
- `0046_ops_assets_and_quota.sql` — provider accounts, traffic cycles, daily errors
- `0047_ops_home_lines.sql` — residential line commercial attributes and metering
- `0048_ops_cron_state.sql` — cron watermarks and customer path-slow hysteresis
- `0049_ops_cron_report.sql` — last cron report payload on `ops_cron_state`
- `0050_ops_followups.sql` — follow-ups, incident `next_check_at` / `closure`
- `0051_ops_candidate_since.sql` — `ops_node_status.candidate_since` for time-based hysteresis
- `0052_ops_device_status.sql` — per-device status; `connection_events.attempt_id` + unique (user, attempt)
- `0053_ops_ledger.sql` — ledger entries, month close, daily FX rates
- `0054_users_wechat_id.sql` — `users.wechat_id` for operator WeChat contact
- `0055_signup_allowlist_profile.sql` — `signup_allowlist.wechat_id` / `contact` / `notes` for onboard-before-register
- `0057_ops_probe_unreachable.sql` — `ops_node_status.verdict` CHECK adds `probe_unreachable`
