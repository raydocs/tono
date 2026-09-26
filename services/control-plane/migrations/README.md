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
schema changes continue from the highest existing number (`0076` at the
time this note was written).

## 0039–0076

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
- `0056_ops_first_connected_at.sql` — `ops_customer_status.first_connected_at` for the onboarding funnel
- `0057_ops_probe_unreachable.sql` — `ops_node_status.verdict` CHECK adds `probe_unreachable`
- `0067_ops_counting_semantics.sql` — per-device daily versions, direct-candidate daily rows, parsed segment ledger
- `0068_client_releases_update_source.sql` — `client_releases` gains `signature` / `min_os_version` / `verified_at` / `object_etag`
- `0069_ops_month_close_snapshot.sql` — `ops_month_close.summary_json` freezes customer and node rows at close
- `0070_drop_orphan_diagnostics_and_destination_tables.sql` — drops four tables no code reads (numbers 0026–0030 were reused long ago)
- `0071_ops_exit_asns.sql` — known exit ASNs so edge attribution can tell tunnel uploads from customer networks
- `0072_hy2_transport.sql` — optional hy2 columns on node profiles, connection events, and quality samples
- `0073_ops_change_receipts.sql` — `ops_change_receipts` records catalog/policy/identity/xray operator writes with rollback-of and ack tracking
- `0074_ops_daily_slo.sql` — `ops_daily_slo` daily SLO rollup per (day, platform, carrier, node), filled by cron
- `0075_ops_node_capacity_users.sql` — `ops_node_profiles.capacity_users` for capacity-based node acceptance
- `0076_ops_node_identity.sql` — immutable `ops_node_identity`; display name, failure domain, and which node it replaces

## 0077

- `0077_retire_legacy_exit_credential_on_revoke.sql` — the first revocation of any device of an account retires the account-wide shared legacy exit credential for good (dual rollout), bumps the catalog and queues a client refresh

## 0078

- `0078_home_exit_name_history.sql` — every name ever used by a catalog home exit stays in the per-user catalog restriction set, whatever its status

## 0079

- `0079_session_rotation_successor.sql` — `sessions.rotated_at` / `successor_id` so a lost refresh response can be recovered once inside the grace window

## 0080

- `0080_home_socks5_rotation_required.sql` — `home_exits.socks5_rotation_required_at`, set by triggers when a socks5 credential leaves a binding or its user is disabled; a flagged credential cannot be bound to another user until replaced

## 0081

- `0081_exit_node_revoked_token.sql` — `exit_nodes.revoked_token_hash` keeps the token hash rotated away at retirement, answer-only, so the still-running exit agent is told "this node is disabled" (403) and withdraws its clients

## 0082

- `0082_customer_activity_windows.sql` — `customer_activity_windows` marks each telemetry window once it is added to activity hours, so the upload hook and the cron projection do not both count it

## 0088

- `0088_diagnostics_log_pending_objects.sql` — write-ahead record for raw log uploads, so retention can delete an R2 object whose index row never landed

## 0090

- `0090_sessions_user_live_index.sql` — `sessions(user_id, revoked_at)` index for the cron enforcement scan, which only enforces ineligible users that still hold a live device or session

## 0091

- `0091_signup_allowlist_entitlement.sql` — `signup_allowlist.expires_at` / `plan` set at onboard before register, copied onto `users` at first sign-in
