import { ApiError } from './errors';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  ADMIN_API_TOKEN: string;
  HOME_AGENT_TOKEN: string;
  TAILSCALE_OAUTH_CLIENT_ID: string;
  TAILSCALE_OAUTH_CLIENT_SECRET: string;
  TAILSCALE_TAILNET: string;
  TAILSCALE_ENROLLMENT_ENABLED?: string;
  ALLOWED_ORIGIN: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TOKEN_TTL_SECONDS: string;
  PENDING_DEVICE_TTL_SECONDS: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_EMAIL_START_IP?: string;
  RATE_LIMIT_EMAIL_START_EMAIL?: string;
  RATE_LIMIT_EMAIL_VERIFY_IP?: string;
  RATE_LIMIT_EMAIL_VERIFY_CHALLENGE?: string;
  RATE_LIMIT_OIDC_START_IP?: string;
  RATE_LIMIT_OIDC_START_INSTALLATION?: string;
  RATE_LIMIT_OIDC_VERIFY_IP?: string;
  RATE_LIMIT_OIDC_VERIFY_CHALLENGE?: string;
  EMAIL_CODE_TTL_SECONDS?: string;
  OIDC_CHALLENGE_TTL_SECONDS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APPLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  DIRECT_SIGNUP_ALLOWLIST?: string;
  CATALOG_ENCRYPTION_KEY?: string;
  // Public half of the offline policy signing key, standard base64, 32 bytes. A
  // var rather than a secret: it is a public key, and keeping it readable is what
  // lets anyone confirm which key this deployment trusts. Unset means signature
  // verification is unavailable, so a signed policy cannot be published and a
  // stored signature cannot be checked — see `publicTrafficPolicy`.
  TRAFFIC_POLICY_PUBLIC_KEY?: string;
  CONFIRM_CLAIM_TTL_SECONDS?: string;
  RATE_LIMIT_DIAGNOSTICS_IP_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_USER_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_USER_DAY?: string;
  DIAGNOSTICS_RETENTION_SECONDS?: string;
  // Raw audit-log segments. The bucket is required, not optional: a build
  // that forgets the binding must fail at the first upload rather than
  // silently accepting segments it cannot store.
  DIAGNOSTICS_LOGS: R2Bucket;
  RELEASES: R2Bucket;
  DIAGNOSTICS_LOG_RETENTION_SECONDS?: string;
  RATE_LIMIT_DIAGNOSTICS_LOG_USER_HOUR?: string;
  RATE_LIMIT_DIAGNOSTICS_LOG_USER_DAY?: string;
  RATE_LIMIT_TELEMETRY_IP_HOUR?: string;
  RATE_LIMIT_TELEMETRY_USER_HOUR?: string;
  RATE_LIMIT_TELEMETRY_USER_DAY?: string;
  TELEMETRY_RETENTION_SECONDS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ADMIN_EMAILS?: string;
  // VPS collector (`ops-panel/collect.py`) pushes the quality report + Komari
  // inventory here. Optional: unset means ingest returns 503 and /ops/live
  // still falls back to the legacy Access-protected hostnames.
  OPS_COLLECTOR_TOKEN?: string;
  RATE_LIMIT_ROUTING_RESEARCH_DEVICE_REQUEST_DAY?: string;
  RATE_LIMIT_ROUTING_RESEARCH_DEVICE_DAY?: string;
  ROUTING_RESEARCH_RETENTION_SECONDS?: string;
  BUILD_SHA?: string;
}

export type Row = Record<string, any>;

export const now = () => Math.floor(Date.now() / 1000);

export const id = () => crypto.randomUUID();

export const str = (v: any, n: string, min = 1, max = 200) => {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${n}`);
  }
  return v;
};

export function envInt(e: Env, key: keyof Env, fallback: number) {
  const raw = e[key];
  if (typeof raw !== 'string' || raw === '') return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function tailscaleEnrollmentEnabled(e: Env) {
  return e.TAILSCALE_ENROLLMENT_ENABLED?.trim().toLowerCase() === 'true';
}

export function requiredSecret(value: unknown) {
  if (typeof value !== 'string' || value.length < 32) {
    throw new ApiError(503, 'SERVICE_MISCONFIGURED', 'Service credentials are not configured');
  }
  return value;
}

export function requiredCatalogKey(e: Env) {
  const value = requiredSecret(e.CATALOG_ENCRYPTION_KEY);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ApiError(503, 'SERVICE_MISCONFIGURED', 'Catalog encryption is not configured');
  }
  return value;
}
