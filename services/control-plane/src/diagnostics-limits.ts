export const DIAGNOSTICS_DAY_SECONDS = 86_400;
// Support can enable one authenticated device for at most one day. Requiring an
// absolute expiry makes repeated PUTs idempotent rather than silently extending
// a troubleshooting session on every retry.
export const DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS = DIAGNOSTICS_DAY_SECONDS;
export const DIAGNOSTICS_MAX_REPORTED_AT_MS = 4_102_444_800_000;
