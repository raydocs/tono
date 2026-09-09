export const DIAGNOSTICS_DAY_SECONDS = 86_400;
// Support can enable one authenticated device for at most one day. Requiring an
// absolute expiry makes repeated PUTs idempotent rather than silently extending
// a troubleshooting session on every retry.
export const DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS = DIAGNOSTICS_DAY_SECONDS;
