# Ingest rate limits

Defaults live in Worker code (`envInt` fallbacks). Production `wrangler.jsonc` `vars` override a subset; unset keys keep the code default. Windows are in seconds.

| Route | Auth | Body cap | Limiter env (default / window) |
| --- | --- | --- | --- |
| `POST /api/v1/telemetry/windows` | User access token (`auth()`) | 72 KiB (`TELEMETRY_BODY_MAX_BYTES`) | `RATE_LIMIT_TELEMETRY_IP_HOUR` 30 / 3600 (ip = `cf-connecting-ip`); `RATE_LIMIT_TELEMETRY_USER_HOUR` 6 / 3600; `RATE_LIMIT_TELEMETRY_USER_DAY` 80 / 86400. Code defaults; not set in `wrangler.jsonc`. |
| `POST /api/v1/telemetry/failures` | User access token (`auth()`) | 8 KiB | `RATE_LIMIT_FAILURE_IP_HOUR` 60 / 3600; `RATE_LIMIT_FAILURE_USER_HOUR` 12 / 3600; `RATE_LIMIT_FAILURE_USER_DAY` 60 / 86400. Limiter runs **before** the body is read. Code defaults; not set in `wrangler.jsonc`. |
| `POST /api/v1/diagnostics/logs` | User access token **and** a live `diagnostics_log_access` row (checked first; no limiter is spent when the window is absent) | 2 MiB gzip (`DIAGNOSTICS_LOG_MAX_BYTES`) | `RATE_LIMIT_DIAGNOSTICS_LOG_USER_HOUR` 80 / 3600; `RATE_LIMIT_DIAGNOSTICS_LOG_USER_DAY` 800 / 86400. User-keyed only (an IP bucket would collapse a household NAT). Production `wrangler.jsonc` sets 80 / 800, matching the code defaults. |
| `POST /api/v1/diagnostics` (reports; extra row so every `RATE_LIMIT_*` key has a home) | User access token (`auth()`) | 32 KiB (`DIAGNOSTICS_BODY_MAX_BYTES`) | `RATE_LIMIT_DIAGNOSTICS_IP_HOUR` 30 / 3600; `RATE_LIMIT_DIAGNOSTICS_USER_HOUR` 5 / 3600; `RATE_LIMIT_DIAGNOSTICS_USER_DAY` 20 / 86400. Production `wrangler.jsonc` sets the same values. |
| `GET`/`PUT`/`DELETE` `/api/v1/{admin,ops}/users/{u}/devices/{d}/diagnostics-logs` | Bearer `ADMIN_API_TOKEN` or Cloudflare Access JWT (`cf-access-jwt-assertion`) | PUT 4 KiB; GET/DELETE have no body. `expiresAt` ≤ now + 86400 | None. |

Other `RATE_LIMIT_*` env keys (`RATE_LIMIT_WINDOW_SECONDS`, email/OIDC start+verify, routing-research) belong to auth and routing-research routes, not this table.
