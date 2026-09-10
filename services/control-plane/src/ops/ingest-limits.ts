import { sha256 } from '../crypto';
import { clientIp } from '../auth';
import { type Env, type Row, now, envInt } from '../env';
import { ApiError } from '../errors';
import { DIAGNOSTICS_DAY_SECONDS } from '../diagnostics-limits';

const DIAGNOSTICS_HOUR_SECONDS = 3_600;

export async function consumeRateLimit(e: Env, key: string, limit: number, windowSeconds: number) {
  const t = now();
  const cutoff = t - windowSeconds;
  const row = await e.DB.prepare(
    `INSERT INTO rate_limits(key, count, window_start)
     VALUES(?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
     RETURNING count`,
  ).bind(key, t, cutoff, cutoff).first<Row>();
  if (!row || Number(row.count) > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later');
  }
}

export async function rateLimitDiagnosticsLog(e: Env, uid: string) {
  // Deliberately keyed on the account only. The IP bucket that guards reports
  // would collapse a household or an office behind one NAT into a single
  // budget, and unlike a report this upload is a background timer the user is
  // not waiting on — the account caps are what bound the cost.
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics-log:user-hour:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_LOG_USER_HOUR', 80),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics-log:user-day:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_LOG_USER_DAY', 800),
    DIAGNOSTICS_DAY_SECONDS,
  );
}

export async function rateLimitDiagnostics(e: Env, req: Request, uid: string) {
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:ip:${clientIp(req)}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_IP_HOUR', 30),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:user-hour:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_USER_HOUR', 5),
    DIAGNOSTICS_HOUR_SECONDS,
  );
  await consumeRateLimit(
    e,
    `rl:${await sha256(`diagnostics:user-day:${uid}`)}`,
    envInt(e, 'RATE_LIMIT_DIAGNOSTICS_USER_DAY', 20),
    DIAGNOSTICS_DAY_SECONDS,
  );
}

const TELEMETRY_KEYS = {
  TELEMETRY: [
    'RATE_LIMIT_TELEMETRY_IP_HOUR',
    'RATE_LIMIT_TELEMETRY_USER_HOUR',
    'RATE_LIMIT_TELEMETRY_USER_DAY',
  ],
  FAILURE: [
    'RATE_LIMIT_FAILURE_IP_HOUR',
    'RATE_LIMIT_FAILURE_USER_HOUR',
    'RATE_LIMIT_FAILURE_USER_DAY',
  ],
} as const satisfies Record<'TELEMETRY' | 'FAILURE', readonly (keyof Env)[]>;

// Failure reports keep their own bucket, or a burst of them starves the heartbeat.
export async function rateLimitTelemetry(
  e: Env,
  req: Request,
  uid: string,
  kind: 'TELEMETRY' | 'FAILURE' = 'TELEMETRY',
) {
  const defaults = kind === 'FAILURE' ? [60, 12, 60] : [30, 6, 80];
  const scopes = [
    [`ip:${clientIp(req)}`, DIAGNOSTICS_HOUR_SECONDS],
    [`user-hour:${uid}`, DIAGNOSTICS_HOUR_SECONDS],
    [`user-day:${uid}`, DIAGNOSTICS_DAY_SECONDS],
  ] as const;
  const keys = TELEMETRY_KEYS[kind];
  for (let i = 0; i < keys.length; i++) {
    const [subject, seconds] = scopes[i];
    await consumeRateLimit(
      e,
      `rl:${await sha256(`${kind.toLowerCase()}:${subject}`)}`,
      envInt(e, keys[i], defaults[i]),
      seconds,
    );
  }
}
