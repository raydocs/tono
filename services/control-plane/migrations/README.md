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
schema changes continue from the highest existing number (`0039` at the
time this note was written).
