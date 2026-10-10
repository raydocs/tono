import {
  randomToken,
  sha256,
} from './crypto';
import { refreshSession } from './sessions';
import {
  OidcVerificationError,
  verifyOidcIdToken,
} from './oidc';
import {
  accountForOidcIdentity,
  accountForVerifiedEmail,
  directSignupAllowed,
  ineligible,
} from './accounts';
import { AccessVerificationError, verifyAccessRequest } from './access';
import { opsConsoleRedirect } from './ops-console-route';
import {
  recordAgentSamples,
  recordHomeProbeSamples,
  recordQualitySamples,
} from './ops-timeseries';
import { enforceAll } from './scheduled';
import { afterSnapshot, recordExitAgentAsn } from './ops/ingest-hooks';
import { consumeRateLimit } from './ops/ingest-limits';
import { opsIngestRoutes } from './ops/ingest';
import { tokenAdminWrite } from './ops/token-admin';
import { ApiError } from './errors';
import { recordClient } from './client-identity';
import { exitIdentityRosterResponse } from './exit-identity-roster';
import { parseBytesRange } from './http';
import {
  type Env,
  type Row,
  now,
  id,
  str,
  envInt,
  tailscaleEnrollmentEnabled,
} from './env';
import {
  auth,
  userId,
  privileged,
  authenticateExitNode,
} from './auth';
import {
  publicManagedCatalog,
} from './catalog';
import {
  publicTrafficPolicy,
} from './traffic-policy';
import {
  rejectUnexpectedKeys,
  body,
  error,
  email,
  optionalText,
} from './request';
import { V1_USAGE_REPORT_NOT_SUPERSEDED } from './retention';
import {
  sharedAdministrativeResource,
  USAGE_METERING_NODE_READY_SECONDS,
  publicAction,
  publicDevice,
  type SharedAdminDeps,
} from './ops/shared-admin';
import {
  liveQualityReport,
  liveAgents,
  storedLiveSnapshot,
  storeLiveSnapshot,
} from './ops/live';
import { publicUser } from './ops/reads';
import { accessSharedResource } from './ops/access-roles';
import {
  opsRoutes, publicSystemRoute,
  type OpsRouterDeps,
} from './ops/router';
import { handleReleaseHost } from './releases/host';
import {
  telemetryRoutes,
  publicDiagnosticsReport,
  publicTelemetryWindow,
  normalizedReferenceCode,
} from './telemetry/routes';
import {
  ROUTING_RESEARCH_DAY_SECONDS,
  ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS,
  canonicalRoutingResearch,
  canonicalActionResult,
  freshestProtectedRouteProof,
  publicAdministrativeAction,
} from './client-reports';
import {
  sha256Hex,
  exitCredentialRoster,
  exitCredentialLabel,
} from './exit-credentials';
import { tailscale } from './tailscale';
import {
  expirePending,
  revokeDevice,
  processRevocations,
  enforceUser,
} from './devices';
import { issueEnrollment, confirmDevice } from './enrollment';
import {
  rateLimitEmailStart,
  rateLimitChallenge,
  rateLimitOidcStart,
  challengeID,
  oidcProvider,
  emailDeliveryConfigured,
  providerAudience,
  numericCode,
  challengeSecret,
  deliverEmailCode,
  completePasswordlessAuth,
} from './login';

export { parseBytesRange } from './http';
export { retirementCatalogPlan } from './catalog-yaml';
export type { Env } from './env';
export { FLEET_QUALITY_STATUSES } from './ops/live';

async function operationsAdmin(req: Request, e: Env) {
  try {
    return await verifyAccessRequest(req, {
      teamDomain: e.ACCESS_TEAM_DOMAIN,
      audience: e.ACCESS_AUD,
      adminEmails: e.ACCESS_ADMIN_EMAILS,
    });
  } catch (verificationError) {
    if (verificationError instanceof AccessVerificationError) {
      if (verificationError.failure === 'misconfigured') {
        throw new ApiError(503, 'ACCESS_MISCONFIGURED', 'Operations access is not configured');
      }
      if (verificationError.failure === 'unavailable') {
        throw new ApiError(503, 'ACCESS_UNAVAILABLE', 'Operations access verification is unavailable');
      }
      if (verificationError.failure === 'forbidden') {
        throw new ApiError(403, 'ACCESS_FORBIDDEN', 'Administrator access is required');
      }
    }
    throw new ApiError(401, 'ACCESS_UNAUTHORIZED', 'Cloudflare Access authentication is required');
  }
}

function buildSha(e: Env): string {
  const value = e.BUILD_SHA?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(value) ? value : 'development';
}

// --- Router -------------------------------------------------------------------

async function route(req: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/v1/health' && m === 'GET') {
    return Response.json({ ok: true, version: '0.0.1', buildSha: buildSha(e), service: 'api' });
  }

  const publicSystem = await publicSystemRoute(req, e, p, m, { buildSha, consumeRateLimit });
  if (publicSystem) return publicSystem;

  if (p === '/api/v1/auth/methods' && m === 'GET') {
    const appleAudience = providerAudience(e, 'apple');
    const googleAudience = providerAudience(e, 'google');
    return Response.json({
      email: { enabled: emailDeliveryConfigured(e) },
      apple: { enabled: appleAudience !== undefined },
      google: {
        enabled: googleAudience !== undefined,
        ...(googleAudience ? { clientId: googleAudience } : {}),
      },
    });
  }

  if (p === '/api/v1/auth/email/start' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    const submittedEmail = email(b.email);
    const name = str(b.deviceName, 'deviceName', 1, 100);
    const inst = str(b.installationId, 'installationId', 8, 200);
    if (!emailDeliveryConfigured(e)) {
      throw new ApiError(503, 'EMAIL_AUTH_UNAVAILABLE', 'Email sign-in is not configured');
    }
    await rateLimitEmailStart(e, req, submittedEmail);

    const existing = await e.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(submittedEmail).first<Row>();
    // A verified mailbox is sufficient to create a test-stage account.
    // Disabled existing users remain ineligible and receive the same public
    // response shape as every other request.
    const eligible = existing
      ? !ineligible(existing)
      : await directSignupAllowed(e, submittedEmail);

    const challenge = id();
    const code = numericCode();
    const t = now();
    const ttl = envInt(e, 'EMAIL_CODE_TTL_SECONDS', 600);
    await e.DB.prepare(
      `INSERT INTO auth_challenges(
         id, kind, email, secret_hash, invitation_id, installation_id,
         device_name, attempts, max_attempts, expires_at, created_at
       ) VALUES(?, 'email_otp', ?, ?, ?, ?, ?, 0, 5, ?, ?)`,
    ).bind(
      challenge,
      submittedEmail,
      await challengeSecret(e, challenge, code),
      null,
      inst,
      name,
      t + ttl,
      t,
    ).run();

    if (eligible) {
      // Decouple provider latency from the public response so response timing
      // does not disclose whether an existing account was eligible.
      ctx.waitUntil((async () => {
        try {
          const delivered = await deliverEmailCode(e, submittedEmail, code, challenge, ttl);
          if (!delivered) {
            // Do not leave an undelivered code usable.
            await e.DB.prepare(
              'UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
            ).bind(now(), challenge).run();
          }
        } catch (deliveryStateError) {
          console.error(
            'email delivery state update failed',
            deliveryStateError instanceof Error
              ? deliveryStateError.message
              : String(deliveryStateError),
          );
        }
      })());
    }
    return Response.json(
      {
        challengeId: challenge,
        expiresIn: ttl,
        message: 'If this email is eligible, a sign-in code has been sent.',
      },
      { status: 202 },
    );
  }

  if (p === '/api/v1/auth/email/verify' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const challenge = challengeID(b.challengeId);
    const code = str(b.code, 'code', 6, 6);
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid code');
    await rateLimitChallenge(e, req, 'email-verify', challenge);
    const t = now();
    const claimed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN secret_hash = ? THEN ? ELSE consumed_at END
       WHERE id = ? AND kind = 'email_otp' AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts
       RETURNING *`,
    ).bind(await challengeSecret(e, challenge, code), t, challenge, t).first<Row>();
    if (!claimed || claimed.consumed_at !== t) {
      throw new ApiError(401, 'INVALID_OR_EXPIRED_CODE', 'The sign-in code is invalid or expired');
    }
    const user = await accountForVerifiedEmail(
      e,
      String(claimed.email).toLowerCase(),
    );
    return Response.json(await completePasswordlessAuth(
      e, req,
      user,
      String(claimed.device_name),
      String(claimed.installation_id),
    ));
  }

  if (p === '/api/v1/auth/oidc/challenge' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const provider = oidcProvider(b.provider);
    const name = str(b.deviceName, 'deviceName', 1, 100);
    const inst = str(b.installationId, 'installationId', 8, 200);
    const audience = providerAudience(e, provider);
    if (!audience) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This identity provider is not configured');
    }
    await rateLimitOidcStart(e, req, inst);
    const challenge = id();
    const nonce = randomToken(32);
    const t = now();
    const ttl = envInt(e, 'OIDC_CHALLENGE_TTL_SECONDS', 300);
    await e.DB.prepare(
      `INSERT INTO auth_challenges(
         id, kind, secret_hash, invitation_id, installation_id, device_name,
         attempts, max_attempts, expires_at, created_at
       ) VALUES(?, ?, ?, ?, ?, ?, 0, 3, ?, ?)`,
    ).bind(
      challenge,
      provider,
      await sha256(nonce),
      null,
      inst,
      name,
      t + ttl,
      t,
    ).run();
    return Response.json({
      challengeId: challenge,
      nonce,
      expiresIn: ttl,
      audience,
    });
  }

  if (p === '/api/v1/auth/oidc/verify' && m === 'POST') {
    const b = await body(req, 24 * 1024);
    const provider = oidcProvider(b.provider);
    const challenge = challengeID(b.challengeId);
    const idToken = str(b.idToken, 'idToken', 100, 16_384);
    const audience = providerAudience(e, provider);
    if (!audience) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This identity provider is not configured');
    }
    await rateLimitChallenge(e, req, 'oidc-verify', challenge);
    const t = now();
    const reserved = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1
       WHERE id = ? AND kind = ? AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts
       RETURNING *`,
    ).bind(challenge, provider, t).first<Row>();
    if (!reserved) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }

    let identity: Awaited<ReturnType<typeof verifyOidcIdToken>>;
    try {
      identity = await verifyOidcIdToken(provider, idToken, audience, t);
    } catch (verificationError) {
      if (
        verificationError instanceof OidcVerificationError &&
        verificationError.temporary
      ) {
        throw new ApiError(
          503,
          'IDENTITY_PROVIDER_UNAVAILABLE',
          'The identity provider is temporarily unavailable',
        );
      }
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const nonceHash = await sha256(identity.nonce);
    if (nonceHash !== reserved.secret_hash) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const consumed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET consumed_at = ?
       WHERE id = ? AND kind = ? AND secret_hash = ?
         AND consumed_at IS NULL AND expires_at > ?`,
    ).bind(t, challenge, provider, nonceHash, t).run();
    if (!consumed.meta.changes) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const user = await accountForOidcIdentity(e, identity);
    return Response.json(await completePasswordlessAuth(
      e, req,
      user,
      String(reserved.device_name),
      String(reserved.installation_id),
    ));
  }

  if (
    (p === '/api/v1/auth/redeem' || p === '/api/v1/auth/login') &&
    m === 'POST'
  ) {
    throw new ApiError(
      410,
      'PASSWORD_AUTH_DISABLED',
      'Password sign-in has been replaced by email, Apple, or Google sign-in',
    );
  }

  if (p === '/api/v1/auth/refresh' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    return Response.json(await refreshSession(e, req, str(b.refreshToken, 'refreshToken', 20, 500)));
  }

  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const a = await auth(req, e);
    const b: Row = await body(req, 4 * 1024).catch(() => ({} as Row));
    const raw = b.refreshToken;
    const t = now();
    const refreshHash = raw === undefined ? null : await sha256(str(raw, 'refreshToken', 20, 500));
    // A refresh can rotate after auth() above. Follow revoked intermediates
    // too, so its successor cannot survive a successful logout. Other sessions on this device end in the same batch; other devices stay signed in.
    await e.DB.batch([
      e.DB.prepare(
        `WITH RECURSIVE logout_sessions(id, successor_id) AS (
           SELECT id, successor_id FROM sessions
           WHERE user_id = ? AND (id = ? OR refresh_hash = ?)
           UNION
           SELECT sessions.id, sessions.successor_id FROM sessions
           JOIN logout_sessions ON sessions.id = logout_sessions.successor_id
           WHERE sessions.user_id = ?
         )
         UPDATE sessions SET revoked_at = ?
         WHERE id IN (SELECT id FROM logout_sessions) AND revoked_at IS NULL`,
      ).bind(a.userId, a.sessionId, refreshHash, a.userId, t),
      e.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL').bind(t, a.userId, a.deviceId),
    ]);
    return new Response(null, { status: 204 });
  }

  if (p === '/api/v1/me' && m === 'GET') {
    const uid = await userId(req, e);
    const u = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first<Row>();
    if (!u) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    return Response.json({ user: publicUser(u) });
  }

  if (p === '/api/v1/exit-catalog' && m === 'GET') {
    const a = await auth(req, e);
    await recordClient(e, req, a.deviceId);
    return Response.json(await publicManagedCatalog(e, {
      userId: a.userId, deviceId: a.deviceId, filterHomeExits: true,
      hy2AcceptHeader: req.headers.get('X-Tono-Accept'),
    }));
  }

  if (p === '/api/v1/traffic-policy' && m === 'GET') {
    await auth(req, e);
    return Response.json(await publicTrafficPolicy(e));
  }

  if (p === '/api/v1/device-actions' && m === 'GET') {
    const a = await auth(req, e);
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE device_id = ? AND status IN ('pending','delivered') AND expires_at <= ?")
      .bind(a.deviceId, t).run();
    const q = await e.DB.prepare(
      "SELECT * FROM device_actions WHERE device_id = ? AND status IN ('pending','delivered') AND expires_at > ? ORDER BY created_at LIMIT 20",
    ).bind(a.deviceId, t).all<Row>();
    const pending = q.results.filter((x) => x.status === 'pending');
    if (pending.length) {
      await e.DB.prepare(
        `UPDATE device_actions SET status = 'delivered', delivered_at = ?
         WHERE device_id = ? AND status = 'pending' AND expires_at > ?`,
      ).bind(t, a.deviceId, t).run();
    }
    return Response.json({ actions: q.results.map((x) => publicAction({ ...x, status: 'delivered', delivered_at: x.delivered_at ?? t })) });
  }

  const actionResultMatch = p.match(/^\/api\/v1\/device-actions\/([^/]+)\/result$/);
  if (actionResultMatch && m === 'POST') {
    const a = await auth(req, e);
    const b = await body(req, 8 * 1024);
    const canonical = canonicalActionResult(b);
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE id = ? AND device_id = ? AND status IN ('pending','delivered') AND expires_at <= ?")
      .bind(actionResultMatch[1], a.deviceId, t).run();
    const existing = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(actionResultMatch[1]).first<Row>();
    if (!existing || existing.device_id !== a.deviceId) throw new ApiError(404, 'NOT_FOUND', 'Action not found');
    if (['succeeded', 'failed'].includes(existing.status)) {
      if (existing.status === canonical.result.outcome && existing.result_json === canonical.json) return Response.json({ action: publicAction(existing) });
      throw new ApiError(409, 'ACTION_RESULT_CONFLICT', 'Action already has a different result');
    }
    if (existing.status !== 'delivered') throw new ApiError(409, 'ACTION_NOT_DELIVERED', 'Action is not available for completion');
    const changed = await e.DB.prepare(
      `UPDATE device_actions SET status = ?, completed_at = ?, result_json = ?
       WHERE id = ? AND device_id = ? AND status = 'delivered' AND expires_at > ?`,
    ).bind(canonical.result.outcome, t, canonical.json, actionResultMatch[1], a.deviceId, t).run();
    if (!changed.meta.changes) throw new ApiError(409, 'ACTION_STATE_CHANGED', 'Action state changed');
    const row = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(actionResultMatch[1]).first<Row>();
    return Response.json({ action: publicAction(row!) });
  }

  const telemetry = await telemetryRoutes(req, e, p, m);
  if (telemetry) return telemetry;

  if (p === '/api/v1/routing-research/snapshots' && m === 'POST') {
    const a = await auth(req, e);
    const declaredOwner = req.headers.get('X-Tono-Routing-Owner');
    if (declaredOwner === null || !/^[0-9a-f]{64}$/.test(declaredOwner) ||
        declaredOwner !== await sha256Hex(a.userId)) {
      // A conflict (rather than 401) prevents an old account's request from
      // triggering token refresh and being replayed under a newer account.
      throw new ApiError(
        409,
        'ROUTING_RESEARCH_OWNER_MISMATCH',
        'Routing research owner does not match the authenticated account',
      );
    }
    // Request-level limits cover malformed bodies, replays, and conflicts. The
    // tighter limiter below applies only to distinct accepted snapshots.
    await consumeRateLimit(
      e,
      `rl:${await sha256(`routing-research:request-device:${a.deviceId}`)}`,
      envInt(e, 'RATE_LIMIT_ROUTING_RESEARCH_DEVICE_REQUEST_DAY', 100),
      ROUTING_RESEARCH_DAY_SECONDS,
    );
    const b = await body(req, 8 * 1024);
    const { snapshot, json } = canonicalRoutingResearch(b);
    const existing = await e.DB.prepare(
      `SELECT aggregate_json, received_at
       FROM routing_research_snapshots
       WHERE device_id = ? AND snapshot_id = ?`,
    ).bind(a.deviceId, snapshot.snapshotId).first<Row>();
    if (existing) {
      if (existing.aggregate_json !== json) throw new ApiError(409, 'SNAPSHOT_ID_CONFLICT', 'Snapshot ID was already used');
      return Response.json({ snapshotId: snapshot.snapshotId, receivedAt: Number(existing.received_at) });
    }
    await consumeRateLimit(
      e,
      `rl:${await sha256(`routing-research:new-device:${a.deviceId}`)}`,
      envInt(e, 'RATE_LIMIT_ROUTING_RESEARCH_DEVICE_DAY', 4),
      ROUTING_RESEARCH_DAY_SECONDS,
    );
    const receivedAt = now();
    const inserted = await e.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(device_id, snapshot_id) DO NOTHING`,
    ).bind(
      id(), snapshot.snapshotId, a.userId, a.deviceId, receivedAt,
      snapshot.observedSince, snapshot.observedUntil, snapshot.appVersion,
      snapshot.build, snapshot.osVersion, snapshot.architecture, json,
    ).run();
    if (!inserted.meta.changes) {
      const replay = await e.DB.prepare(
        `SELECT aggregate_json, received_at
         FROM routing_research_snapshots
         WHERE device_id = ? AND snapshot_id = ?`,
      ).bind(a.deviceId, snapshot.snapshotId).first<Row>();
      if (replay?.aggregate_json === json) {
        return Response.json({
          snapshotId: snapshot.snapshotId,
          receivedAt: Number(replay.received_at),
        });
      }
      throw new ApiError(
        409,
        'SNAPSHOT_ID_CONFLICT',
        'Snapshot ID was already used',
      );
    }
    return Response.json({ snapshotId: snapshot.snapshotId, receivedAt }, { status: 201 });
  }

  if (p === '/api/v1/devices' && m === 'GET') {
    const a = await auth(req, e);
    await expirePending(e, a.userId);
    // Revoked devices are dead weight in a management list: the client renders
    // every row it gets, so leaving them in makes a successful revoke look like
    // it did nothing.
    const q = await e.DB.prepare(
      "SELECT * FROM devices WHERE user_id = ? AND status != 'revoked' ORDER BY created_at DESC",
    ).bind(a.userId).all<Row>();
    return Response.json({ devices: q.results.map((x) => publicDevice(x, a.deviceId)) });
  }

  let mt = p.match(/^\/api\/v1\/devices\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const uid = await userId(req, e);
    const d = await e.DB.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').bind(mt[1], uid).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    await revokeDevice(e, d);
    await processRevocations(e);
    return new Response(null, { status: 204 });
  }

  mt = p.match(/^\/api\/v1\/devices\/([^/]+)\/enrollment$/);
  if (mt && m === 'POST') {
    if (!tailscaleEnrollmentEnabled(e)) {
      throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
    }
    const a = await auth(req, e);
    if (a.deviceId !== mt[1]) throw new ApiError(404, 'NOT_FOUND', 'Device not found for this session');
    const b = await body(req, 4 * 1024);
    const requestedInstallation = str(b.installationId, 'installationId', 8, 200);
    if (requestedInstallation !== a.installationId) {
      throw new ApiError(404, 'NOT_FOUND', 'Device not found for this installation');
    }
    let d = await e.DB.prepare(
      "SELECT * FROM devices WHERE id = ? AND user_id = ? AND installation_id = ? AND status IN ('pending', 'active')",
    ).bind(mt[1], a.userId, a.installationId).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found for this installation');
    if (d.status === 'active') {
      const t = now();
      const generation = Number(d.claim_generation ?? 0);
      const [, r] = await e.DB.batch([
        e.DB.prepare(
          `INSERT INTO revocation_jobs(
             id, device_id, tailscale_node_id, created_at, ownership_generation, reason
           )
           SELECT ?, id, tailscale_node_id, ?, claim_generation, 'identity_reenrollment'
           FROM devices
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status = 'active' AND claim_generation = ?
             AND tailscale_node_id IS NOT NULL
           ON CONFLICT(tailscale_node_id) DO UPDATE SET
             completed_at = NULL,
             last_error = NULL,
             last_attempt_at = 0,
             device_id = excluded.device_id,
             created_at = excluded.created_at,
             ownership_generation = excluded.ownership_generation,
             reason = excluded.reason`,
        ).bind(id(), t, d.id, a.userId, a.installationId, generation),
        e.DB.prepare(
          `UPDATE devices SET
             status = 'pending',
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             pending_expires_at = ?,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = NULL,
             updated_at = ?
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status = 'active' AND claim_generation = ?`,
        ).bind(
          t + envInt(e, 'PENDING_DEVICE_TTL_SECONDS', 1_800),
          t,
          d.id,
          a.userId,
          a.installationId,
          generation,
        ),
      ]);
      if (!r.meta.changes) throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed');
      await processRevocations(e);
      d = (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
    }
    if (d.pending_expires_at <= now()) throw new ApiError(404, 'NOT_FOUND', 'Pending device expired');
    return Response.json({ enrollment: await issueEnrollment(e, d) });
  }

  mt = p.match(/^\/api\/v1\/devices\/([^/]+)\/confirm$/);
  if (mt && m === 'POST') {
    if (!tailscaleEnrollmentEnabled(e)) {
      throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
    }
    const a = await auth(req, e);
    const b = await body(req, 16 * 1024);
    const device = await confirmDevice(e, a, mt[1], b);
    return Response.json({ device });
  }

  const ingest = await opsIngestRoutes(req, e, p, m);
  if (ingest) return ingest;

  if (p === '/api/v1/ops-ingest/home-targets' && m === 'GET') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const q = await e.DB.prepare(
      `SELECT id, socks5_host, socks5_port FROM home_exits
       WHERE kind = 'socks5' AND status = 'active' AND socks5_host IS NOT NULL AND socks5_port IS NOT NULL
       LIMIT 200`,
    ).all<Row>();
    return Response.json({
      targets: q.results.map((row) => ({
        id: String(row.id),
        host: String(row.socks5_host),
        port: Number(row.socks5_port),
      })),
    });
  }

  // The roster the node client lists are reconciled against.
  //
  // Same rows as `/api/v1/home/exit-identities`, which the home agent reads
  // with its own token; this exists so the collector can drive node sync with
  // the token it already holds, rather than widening the home agent's.
  if (p === '/api/v1/ops-ingest/node-clients' && m === 'GET') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const t = now();
    const roster = await exitCredentialRoster(e, t);
    return Response.json({
      // Echoed so a reconciling agent can tell a stale response from an empty
      // roster: applying an empty list as if it were current would remove every
      // managed client from every node at once.
      observedAt: t,
      retireSharedLegacy: roster.retireSharedLegacy,
      clients: await Promise.all(roster.rows.map(async (row) => {
        const userId = String(row.user_id);
        const deviceId = row.device_id ? String(row.device_id) : null;
        const clientUUID = String(row.client_uuid);
        return {
          userId,
          deviceId: deviceId ?? undefined,
          clientUUID,
          // Credential generation is part of the metric label, so replacing a
          // device UUID cannot leave the old UUID installed under the same
          // label. Hash it rather than exposing an access credential in stats.
          email: await exitCredentialLabel(userId, deviceId, clientUUID),
        };
      })),
    });
  }

  if (p === '/api/v1/ops-ingest/snapshot' && m === 'PUT') {
    if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
      throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
    }
    await privileged(req, e.OPS_COLLECTOR_TOKEN);
    const payload = await body(req, 768 * 1024);
    rejectUnexpectedKeys(payload, ['report', 'agents', 'homeProbes']);
    if (payload.report === undefined && payload.agents === undefined && payload.homeProbes === undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'report, agents or homeProbes is required');
    }
    const receivedAt = now();
    let quality = payload.report === undefined
      ? undefined
      : liveQualityReport(payload.report, receivedAt);
    if (payload.report !== undefined && !quality) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quality report');
    }
    let agents = payload.agents === undefined ? undefined : liveAgents(payload.agents, receivedAt);
    if (payload.agents !== undefined && !agents) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid agent inventory');
    }
    // A collector that reaches Komari but gets an empty answer must not wipe
    // the live view: storing "[]" with a fresh timestamp flips every node to
    // "missing" with a current snapshot vouching for it. Keep the stored list
    // (and its age) and tell the collector, the same way the node-clients
    // roster refuses to apply an empty list. An empty list is still accepted
    // when nothing is stored yet.
    let reportIgnoredEmpty = false;
    let agentsIgnoredEmpty = false;
    if ((quality && quality.nodes.length === 0) || (agents && agents.length === 0)) {
      const current = await storedLiveSnapshot(e);
      if (quality && quality.nodes.length === 0 && current?.quality_json) {
        const storedQuality = JSON.parse(String(current.quality_json)) as Row | null;
        if (storedQuality && Array.isArray(storedQuality.nodes) && storedQuality.nodes.length > 0) {
          quality = undefined;
          reportIgnoredEmpty = true;
        }
      }
      if (agents && agents.length === 0 && current?.agents_json) {
        const storedAgents = JSON.parse(String(current.agents_json)) as unknown;
        if (Array.isArray(storedAgents) && storedAgents.length > 0) {
          agents = undefined;
          agentsIgnoredEmpty = true;
        }
      }
    }
    let probesUpdated = 0;
    const acceptedProbes: Array<{ id: string; status: 'alive' | 'dead' }> = [];
    if (payload.homeProbes !== undefined) {
      if (!Array.isArray(payload.homeProbes) || payload.homeProbes.length > 200) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid homeProbes');
      }
      const t = now();
      const validated: Array<{ id: string; status: 'alive' | 'dead' }> = [];
      for (const raw of payload.homeProbes) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid homeProbes');
        }
        const probe = raw as Row;
        const probeId = str(probe.id, 'id', 1, 100);
        const status = str(probe.status, 'status', 1, 20);
        if (status !== 'alive' && status !== 'dead') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid home probe status');
        }
        validated.push({ id: probeId, status });
      }
      if (validated.length) {
        const results = await e.DB.batch(validated.map((probe) => e.DB.prepare(
          `UPDATE home_exits SET last_probed_at = ?, probe_status = ?, updated_at = updated_at
           WHERE id = ? AND kind = 'socks5'
             AND (probe_status != ? OR last_probed_at IS NULL OR last_probed_at <= ?)`,
        ).bind(t, probe.status, probe.id, probe.status, t - 300)));
        results.forEach((result, index) => {
          if (result.meta.changes) {
            probesUpdated += 1;
            acceptedProbes.push(validated[index]);
          }
        });
      }
      if (acceptedProbes.length) {
        await recordHomeProbeSamples(e.DB, acceptedProbes, t);
      }
    }
    const stored = payload.report === undefined && payload.agents === undefined
      ? { qualityUpdatedAt: null, agentsUpdatedAt: null, updatedAt: now() }
      : await storeLiveSnapshot(e, {
        quality: quality ?? undefined,
        agents: agents ?? undefined,
      });
    if (agents) {
      await recordAgentSamples(e.DB, agents as Array<{
        name: string;
        cpu: number | null;
        cpuCores: number | null;
        memTotal: number | null;
        memUsed: number | null;
        diskTotal: number | null;
        diskUsed: number | null;
        netIn: number | null;
        netOut: number | null;
        load1: number | null;
        load5: number | null;
        load15: number | null;
        swapTotal: number | null;
        swapUsed: number | null;
        tcpConnections: number | null;
        processes: number | null;
        uptime: number | null;
        observedAt: number | null;
      }>, stored.updatedAt);
    }
    if (quality?.nodes.length) {
      await recordQualitySamples(
        e.DB,
        quality.nodes.map((node) => ({
          name: String(node.name),
          ok: node.ok === true,
          quality: typeof node.quality === 'string' ? node.quality : null,
          blockStatus: node.block && typeof node.block === 'object'
            ? (optionalText((node.block as Row).status) ?? null)
            : null,
        })),
        stored.updatedAt,
      );
    }
    await afterSnapshot(e, stored.updatedAt);
    return Response.json({
      ok: true,
      qualityNodes: quality?.nodes.length ?? null,
      agentCount: agents?.length ?? null,
      homeProbesUpdated: probesUpdated,
      ...(reportIgnoredEmpty ? { reportIgnoredEmpty: true } : {}),
      ...(agentsIgnoredEmpty ? { agentsIgnoredEmpty: true } : {}),
      ...stored,
    });
  }

  const sharedAdminDeps: SharedAdminDeps = {
    revokeDevice,
    processRevocations,
    enforceUser,
    publicAdministrativeAction,
  };

  const opsRouterDeps: OpsRouterDeps = {
    buildSha,
    freshestProtectedRouteProof,
    enforceUser,
    sharedAdminDeps,
  };

  if (p.startsWith('/api/v1/ops/')) {
    const actor = await operationsAdmin(req, e);
    const shared = await accessSharedResource(
      req, e, p.slice('/api/v1/ops/'.length), m, actor.email, sharedAdminDeps,
    );
    if (shared) return shared;
    const routed = await opsRoutes(req, e, p, m, actor, ctx, opsRouterDeps);
    if (routed) return routed;
    return new Response(null, {
      status: 405,
      headers: { allow: 'GET, POST, PUT, PATCH, DELETE' },
    });
  }

  if (p.startsWith('/api/v1/admin/')) {
    await privileged(req, e.ADMIN_API_TOKEN);
    const shared = await sharedAdministrativeResource(
      req, e, p.slice('/api/v1/admin/'.length), m, 'token-admin', sharedAdminDeps,
    );
    if (shared) return shared;
    if (p === '/api/v1/admin/routing-research/summary' && m === 'GET') {
      let unexpectedQuery = false;
      url.searchParams.forEach((_value, key) => { if (key !== 'days') unexpectedQuery = true; });
      if (unexpectedQuery) throw new ApiError(400, 'VALIDATION_ERROR', 'Unexpected query parameter');
      const rawDays = url.searchParams.get('days');
      const days = rawDays === null ? 30 : Number(rawDays);
      if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid days');
      const timestamp = now();
      const since = timestamp - days * ROUTING_RESEARCH_DAY_SECONDS;
      // Filter by when traffic was observed rather than delayed receipt time.
      // JSON1 expands only the canonical fixed-vocabulary entries; grouping is
      // done in D1 so no per-user rows enter the API process or response.
      const overall = await e.DB.prepare(
        `SELECT COUNT(*) snapshot_count,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count
         FROM routing_research_snapshots
         WHERE observed_until >= ? AND observed_until <= ?`,
      ).bind(since, timestamp).first<Row>();
      const participantCount = Number(overall?.participant_count ?? 0);
      if (participantCount < ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS) {
        return Response.json({
          days,
          cohortMinimum: ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS,
          suppressed: true,
          byApp: [],
          byBundleComponent: [],
          byBuild: [],
        });
      }
      const appRows = await e.DB.prepare(
        `WITH filtered AS (
           SELECT user_id, device_id, aggregate_json
           FROM routing_research_snapshots
           WHERE observed_until >= ? AND observed_until <= ?
         ), entries AS (
           SELECT filtered.user_id, filtered.device_id,
                  json_extract(item.value, '$.app') app,
                  json_extract(item.value, '$.connectionCount') connection_count,
                  json_extract(item.value, '$.directConnectionCount') direct_count,
                  json_extract(item.value, '$.proxiedConnectionCount') proxied_count,
                  json_extract(item.value, '$.blockedConnectionCount') blocked_count,
                  json_extract(item.value, '$.trafficVolume') traffic_volume
           FROM filtered, json_each(filtered.aggregate_json, '$.entries') item
         )
         SELECT app, COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count,
                SUM(connection_count) connection_count,
                SUM(direct_count) direct_count,
                SUM(proxied_count) proxied_count,
                SUM(blocked_count) blocked_count,
                SUM(CASE WHEN traffic_volume = 'none' THEN 1 ELSE 0 END) volume_none,
                SUM(CASE WHEN traffic_volume = 'under_1_mib' THEN 1 ELSE 0 END) volume_under_1_mib,
                SUM(CASE WHEN traffic_volume = '1_to_10_mib' THEN 1 ELSE 0 END) volume_1_to_10_mib,
                SUM(CASE WHEN traffic_volume = '10_to_100_mib' THEN 1 ELSE 0 END) volume_10_to_100_mib,
                SUM(CASE WHEN traffic_volume = '100_mib_to_1_gib' THEN 1 ELSE 0 END) volume_100_mib_to_1_gib,
                SUM(CASE WHEN traffic_volume = '1_to_10_gib' THEN 1 ELSE 0 END) volume_1_to_10_gib,
                SUM(CASE WHEN traffic_volume = 'over_10_gib' THEN 1 ELSE 0 END) volume_over_10_gib
         FROM entries
         GROUP BY app
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, device_count DESC, app`,
      ).bind(since, timestamp).all<Row>();
      const componentRows = await e.DB.prepare(
        `WITH filtered AS (
           SELECT user_id, device_id, aggregate_json
           FROM routing_research_snapshots
           WHERE observed_until >= ? AND observed_until <= ?
         ), components AS (
           SELECT filtered.user_id, filtered.device_id,
                  json_extract(item.value, '$.app') app,
                  json_extract(item.value, '$.bundleComponent') bundle_component,
                  json_extract(item.value, '$.connectionCount') connection_count,
                  json_extract(item.value, '$.directConnectionCount') direct_count,
                  json_extract(item.value, '$.proxiedConnectionCount') proxied_count,
                  json_extract(item.value, '$.blockedConnectionCount') blocked_count,
                  json_extract(item.value, '$.trafficVolume') traffic_volume
           FROM filtered,
                json_each(filtered.aggregate_json, '$.bundleComponents') item
         )
         SELECT app, bundle_component,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count,
                SUM(connection_count) connection_count,
                SUM(direct_count) direct_count,
                SUM(proxied_count) proxied_count,
                SUM(blocked_count) blocked_count,
                SUM(CASE WHEN traffic_volume = 'none' THEN 1 ELSE 0 END) volume_none,
                SUM(CASE WHEN traffic_volume = 'under_1_mib' THEN 1 ELSE 0 END) volume_under_1_mib,
                SUM(CASE WHEN traffic_volume = '1_to_10_mib' THEN 1 ELSE 0 END) volume_1_to_10_mib,
                SUM(CASE WHEN traffic_volume = '10_to_100_mib' THEN 1 ELSE 0 END) volume_10_to_100_mib,
                SUM(CASE WHEN traffic_volume = '100_mib_to_1_gib' THEN 1 ELSE 0 END) volume_100_mib_to_1_gib,
                SUM(CASE WHEN traffic_volume = '1_to_10_gib' THEN 1 ELSE 0 END) volume_1_to_10_gib,
                SUM(CASE WHEN traffic_volume = 'over_10_gib' THEN 1 ELSE 0 END) volume_over_10_gib
         FROM components
         GROUP BY app, bundle_component
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, device_count DESC, app,
                  bundle_component`,
      ).bind(since, timestamp).all<Row>();
      const buildRows = await e.DB.prepare(
        `SELECT app_version, build,
                COUNT(DISTINCT user_id) participant_count,
                COUNT(DISTINCT device_id) device_count,
                COUNT(*) snapshot_count
         FROM routing_research_snapshots
         WHERE observed_until >= ? AND observed_until <= ?
         GROUP BY app_version, build
         HAVING COUNT(DISTINCT user_id) >= 3
         ORDER BY participant_count DESC, app_version DESC, build DESC`,
      ).bind(since, timestamp).all<Row>();
      return Response.json({
        days,
        cohortMinimum: ROUTING_RESEARCH_MIN_SUMMARY_PARTICIPANTS,
        participantCount,
        deviceCount: Number(overall?.device_count ?? 0),
        snapshotCount: Number(overall?.snapshot_count ?? 0),
        byApp: appRows.results.map((row) => ({
          app: String(row.app),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
          connectionCount: Number(row.connection_count),
          directConnectionCount: Number(row.direct_count),
          proxiedConnectionCount: Number(row.proxied_count),
          blockedConnectionCount: Number(row.blocked_count),
          trafficVolumes: {
            none: Number(row.volume_none),
            under_1_mib: Number(row.volume_under_1_mib),
            '1_to_10_mib': Number(row.volume_1_to_10_mib),
            '10_to_100_mib': Number(row.volume_10_to_100_mib),
            '100_mib_to_1_gib': Number(row.volume_100_mib_to_1_gib),
            '1_to_10_gib': Number(row.volume_1_to_10_gib),
            over_10_gib: Number(row.volume_over_10_gib),
          },
        })),
        byBundleComponent: componentRows.results.map((row) => ({
          app: String(row.app),
          bundleComponent: String(row.bundle_component),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
          connectionCount: Number(row.connection_count),
          directConnectionCount: Number(row.direct_count),
          proxiedConnectionCount: Number(row.proxied_count),
          blockedConnectionCount: Number(row.blocked_count),
          trafficVolumes: {
            none: Number(row.volume_none),
            under_1_mib: Number(row.volume_under_1_mib),
            '1_to_10_mib': Number(row.volume_1_to_10_mib),
            '10_to_100_mib': Number(row.volume_10_to_100_mib),
            '100_mib_to_1_gib': Number(row.volume_100_mib_to_1_gib),
            '1_to_10_gib': Number(row.volume_1_to_10_gib),
            over_10_gib: Number(row.volume_over_10_gib),
          },
        })),
        byBuild: buildRows.results.map((row) => ({
          appVersion: String(row.app_version),
          build: String(row.build),
          participantCount: Number(row.participant_count),
          deviceCount: Number(row.device_count),
          snapshotCount: Number(row.snapshot_count),
        })),
      });
    }

    mt = p.match(/^\/api\/v1\/admin\/diagnostics\/reports\/([^/]+)$/);
    if (mt && m === 'GET') {
      const row = await e.DB.prepare(
        'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
      ).bind(normalizedReferenceCode(mt[1])).first<Row>();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Diagnostics report not found');
      return Response.json({ report: publicDiagnosticsReport(row) });
    }
    if (p === '/api/v1/admin/telemetry/windows' && m === 'GET') {
      const userId = url.searchParams.get('userId');
      if (userId !== null && (userId.length < 1 || userId.length > 200)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid userId');
      }
      const q = userId
        ? await e.DB.prepare(
          'SELECT * FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 100',
        ).bind(userId).all<Row>()
        : await e.DB.prepare(
          'SELECT * FROM telemetry_windows ORDER BY received_at DESC LIMIT 100',
        ).all<Row>();
      return Response.json({ windows: q.results.map(publicTelemetryWindow) });
    }
    if (p === '/api/v1/admin/signup-allowlist' && m === 'GET') {
      const q = await e.DB.prepare(
        'SELECT email, created_at FROM signup_allowlist ORDER BY created_at DESC, email ASC',
      ).all<Row>();
      return Response.json({
        entries: q.results.map((entry) => ({
          email: entry.email,
          createdAt: Number(entry.created_at),
        })),
      });
    }
    const tokenWrite = await tokenAdminWrite(req, e, p, m, { enforceUser, processRevocations });
    if (tokenWrite) return tokenWrite;
    if (p === '/api/v1/admin/invitations' && m === 'GET') {
      const q = await e.DB.prepare(
        'SELECT id, email, expires_at, redeemed_at, created_at FROM invitations ORDER BY created_at DESC',
      ).all();
      return Response.json({ invitations: q.results });
    }
    if (p === '/api/v1/admin/users' && m === 'GET') {
      const q = await e.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all<Row>();
      return Response.json({ users: q.results.map(publicUser) });
    }
  }

  if (p === '/api/v1/home/inventory' && m === 'GET') {
    const node = await authenticateExitNode(req, e, true);
    const t = now();
    const rows = await e.DB.prepare(
      `SELECT
         devices.tailscale_stable_id,
         devices.tailscale_public_key,
         devices.user_id,
         devices.status,
         users.usage_bytes,
         COALESCE(source.last_total_bytes, 0) AS source_usage_bytes
       FROM devices
       JOIN users ON users.id = devices.user_id
       LEFT JOIN usage_report_sources source
         ON source.user_id = devices.user_id AND source.source_id = ?
       WHERE devices.tailscale_stable_id IS NOT NULL
         AND devices.tailscale_public_key IS NOT NULL
       ORDER BY devices.tailscale_stable_id, devices.created_at
       LIMIT 2001`,
    ).bind(node?.id ?? '').all<Row>();
    if (rows.results.length > 2_000) {
      throw new ApiError(
        503,
        'HOME_INVENTORY_TOO_LARGE',
        'Home inventory requires a paginated agent upgrade',
      );
    }
    return Response.json({
      nodeId: node?.id,
      observedAt: t,
      devices: rows.results.map((row) => ({
        stableNodeId: String(row.tailscale_stable_id),
        // This key was matched against server-side inventory during confirm.
        // Older Device API versions may not expose stableNodeId, so the home
        // agent uses publicKey—not client audit metadata—for attribution.
        publicKey: String(row.tailscale_public_key),
        userId: String(row.user_id),
        status: String(row.status),
        usageBytes: Number(row.usage_bytes),
        // A reporter's cumulative counter is scoped to its authenticated
        // source. Seeding each node from the account-wide SUM makes every
        // additional exit re-report the other exits' history and overbill the
        // account. Keep usageBytes for old read-only dual-phase consumers, but
        // new reporters must recover from this source-local watermark.
        sourceUsageBytes: Number(row.source_usage_bytes),
      })),
    });
  }

  // The list an exit reconciles its client roster against. Pull rather than push:
  // an exit reaching out needs no inbound path and no per-exit credential held by
  // the control plane, and a Worker cannot reach a private management API anyway.
  //
  // The list *is* the enforcement. It excludes accounts that are not active, have
  // expired, or have passed their quota, so an exit that reconciles removes them —
  // and removal is what stops traffic. Enforcement that only stops counting does
  // not stop anything.
  if (p === '/api/v1/home/exit-identities' && m === 'GET') {
    const node = await authenticateExitNode(req, e, true);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const t = now();
    const roster = await exitCredentialRoster(e, t);
    return exitIdentityRosterResponse(e, node?.id, t, roster);
  }

  if (p === '/api/v1/home/roster-ack' && m === 'POST') {
    const node = await authenticateExitNode(req, e);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['observedAt', 'meteringProtocolVersion']);
    const t = now();
    if (
      !Number.isSafeInteger(b.observedAt) ||
      b.observedAt < 0 ||
      b.observedAt > t + 300
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid roster observedAt');
    }
    await e.DB.prepare(
      `UPDATE exit_nodes
       SET last_roster_at = MAX(last_roster_at, ?), updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(b.observedAt, t, node!.id).run();
    return Response.json({ nodeId: node!.id, observedAt: b.observedAt });
  }

  if (p === '/api/v1/home/metering-ack' && m === 'POST') {
    const node = await authenticateExitNode(req, e);
    await recordExitAgentAsn(e, req, node?.name ?? null);
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['meteringProtocolVersion', 'observedAt']);
    const t = now();
    if (
      b.meteringProtocolVersion !== 2 ||
      !Number.isSafeInteger(b.observedAt) ||
      b.observedAt > t ||
      b.observedAt <= t - USAGE_METERING_NODE_READY_SECONDS
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid metering acknowledgement');
    }
    await e.DB.prepare(
      `UPDATE exit_nodes
       SET metering_protocol_version = 2,
           metering_last_seen_at = ?
       WHERE id = ? AND status = 'active'
         AND metering_last_seen_at < ?`,
    ).bind(b.observedAt, node!.id, b.observedAt).run();
    return Response.json({
      nodeId: node!.id,
      meteringProtocolVersion: 2,
      observedAt: b.observedAt,
    });
  }

  // Same handler for the home agent and the collector. The collector is what
  // has SSH to all sixteen nodes and therefore what reads the per-user byte
  // counters; giving it the home agent's token instead would widen that one
  // rather than scope this.
  //
  // Named reporters are shadowed while a legacy source exists. The explicit
  // v2 cutover snapshots the named sum already represented by the legacy
  // authority, after which only named-source growth advances account usage.
  if ((p === '/api/v1/home/usage' || p === '/api/v1/ops-ingest/usage') && m === 'POST') {
    let authenticatedSourceId = '';
    const metering = await e.DB.prepare(
      'SELECT phase FROM usage_metering_rollout WHERE singleton_id = 1',
    ).first<Row>();
    const meteringPhase = metering?.phase === 'v2_required' ? 'v2_required' : 'dual';
    if (p === '/api/v1/ops-ingest/usage') {
      if (typeof e.OPS_COLLECTOR_TOKEN !== 'string' || e.OPS_COLLECTOR_TOKEN.length < 32) {
        throw new ApiError(503, 'OPS_INGEST_UNCONFIGURED', 'Collector ingest is not configured');
      }
      await privileged(req, e.OPS_COLLECTOR_TOKEN);
      if (meteringPhase === 'v2_required') {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Legacy collector metering is disabled');
      }
    } else {
      const node = await authenticateExitNode(req, e);
      authenticatedSourceId = node!.id;
      await recordExitAgentAsn(e, req, node!.name);
    }
    const b = await body(req, 512 * 1024);
    const reports = b.reports;
    if (!Array.isArray(reports) || reports.length < 1 || reports.length > 500) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'reports must contain 1-500 items');
    }
    const receivedAt = now();
    const unique = new Map<string, {
      reportId: string;
      userId: string;
      sourceId: string;
      protocolVersion: number;
      totalBytes: number;
      observedAt: number;
    }>();
    const users = new Set<string>();
    for (const x of reports) {
      if (x === null || typeof x !== 'object' || Array.isArray(x)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid usage report');
      }
      const reportId = str(x.reportId, 'reportId', 1, 100);
      const reportUserId = str(x.userId, 'userId', 1, 100);
      const submittedSourceId = x.sourceId === undefined || x.sourceId === null
        ? null
        : str(x.sourceId, 'sourceId', 1, 64);
      if (p === '/api/v1/home/usage') {
        if (submittedSourceId === null) {
          throw new ApiError(400, 'SOURCE_ID_REQUIRED', 'Named usage must include its sourceId');
        }
        if (submittedSourceId !== authenticatedSourceId) {
          throw new ApiError(403, 'SOURCE_ID_MISMATCH', 'Usage source does not match the authenticated exit node');
        }
      }
      if (p === '/api/v1/ops-ingest/usage' && submittedSourceId !== null) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Collector usage may not name an exit source');
      }
      // The trusted source is the authenticated exit-node record. The legacy
      // collector remains in the empty-string MAX bucket and cannot impersonate
      // a per-node SUM counter.
      const reportSourceId = authenticatedSourceId;
      const reportProtocolVersion = x.protocolVersion === undefined || x.protocolVersion === null
        ? 1
        : x.protocolVersion;
      if (p === '/api/v1/ops-ingest/usage' && reportProtocolVersion !== 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Collector usage is legacy protocol v1');
      }
      if (
        p === '/api/v1/home/usage' &&
        meteringPhase === 'v2_required' &&
        reportProtocolVersion !== 2
      ) {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Named usage must use protocol v2');
      }
      if (
        !Number.isSafeInteger(reportProtocolVersion) ||
        (reportProtocolVersion !== 1 && reportProtocolVersion !== 2) ||
        !Number.isSafeInteger(x.totalBytes) ||
        x.totalBytes < 0 ||
        !Number.isSafeInteger(x.observedAt) ||
        x.observedAt < 0 ||
        x.observedAt > receivedAt + 300
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid usage report');
      }
      const normalized = {
        reportId,
        userId: reportUserId,
        sourceId: reportSourceId,
        protocolVersion: reportProtocolVersion as number,
        totalBytes: x.totalBytes as number,
        observedAt: x.observedAt as number,
      };
      const prior = unique.get(reportId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Conflicting duplicate reportId');
      }
      unique.set(reportId, normalized);
      users.add(reportUserId);
    }
    if (users.size > 100) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'A batch may contain at most 100 distinct users');
    }

    // The fold below consumes one observation per (account, source). Combining
    // two rows with independent MAX(totalBytes) and MAX(observedAt) manufactures
    // a pair that no reporter sent and can hide a real counter reset. Agents
    // already queue at most one cumulative report per source/account, so reject
    // ambiguous callers instead of guessing an order.
    const sourceReports = new Set<string>();
    for (const report of unique.values()) {
      const key = JSON.stringify([report.userId, report.sourceId]);
      if (sourceReports.has(key)) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'A batch may contain at most one report per user and source',
        );
      }
      sourceReports.add(key);
    }

    const encodedReports = JSON.stringify([...unique.values()]);
    const unknownUser = await e.DB.prepare(
      `WITH input AS (
         SELECT json_extract(value, '$.userId') AS user_id
         FROM json_each(?)
       )
       SELECT input.user_id
       FROM input LEFT JOIN users ON users.id = input.user_id
       WHERE users.id IS NULL
       LIMIT 1`,
    ).bind(encodedReports).first<Row>();
    if (unknownUser) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Usage report references an unknown user');
    }

    try {
      await e.DB.batch([
        ...(p === '/api/v1/ops-ingest/usage' ? [e.DB.prepare(
          `UPDATE usage_metering_rollout
           SET legacy_last_seen_at = ?
           WHERE singleton_id = 1
             AND (phase = 'v2_required' OR legacy_last_seen_at < ?)`,
        ).bind(receivedAt, receivedAt - 60)] : []),
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         )
         INSERT OR IGNORE INTO usage_reports(
           report_id, user_id, source_id, protocol_version, total_bytes, observed_at, created_at
         )
         SELECT report_id, user_id, source_id, protocol_version, total_bytes, observed_at, ?
         FROM input
         -- Protocol v2 is durably idempotent on the strictly increasing
         -- (user, authenticated source, observed_at) watermark below. Storing
         -- and later deleting a second row for every report multiplies the D1
         -- write volume without adding replay protection. Retain immutable IDs
         -- only for legacy v1 senders whose wall clocks are not monotonic. A
         -- fresh legacy ID carrying an unchanged/lower MAX counter is neither
         -- replay evidence nor billing input, so it writes no row. Reusing an
         -- existing ID is still attempted so the immutability trigger can
         -- distinguish an exact replay from conflicting content.
         WHERE protocol_version = 1
           AND (
             source_id != ''
             OR EXISTS (
               SELECT 1 FROM usage_reports
               WHERE usage_reports.report_id = input.report_id
             )
             OR NOT EXISTS (
               SELECT 1 FROM usage_report_sources
               WHERE usage_report_sources.user_id = input.user_id
                 AND usage_report_sources.source_id = input.source_id
             )
             OR total_bytes > COALESCE((
               SELECT last_total_bytes FROM usage_report_sources
               WHERE usage_report_sources.user_id = input.user_id
                 AND usage_report_sources.source_id = input.source_id
             ), -1)
           )`,
        ).bind(encodedReports, receivedAt),
        // One cumulative figure per (account, source). Within a source the
        // figure only ever rises, so the difference from the last one is what
        // this source has newly carried; a figure *below* the last one is a node
        // that was rebuilt and started counting again, and all of it is new. The
        // legacy source keeps MAX instead: it is an aggregate over a changing
        // set of nodes, so it falls when a node leaves the fleet, and reading
        // that as a reset would bill the account for its history a second time.
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         ),
         accepted AS (
           SELECT input.user_id,
                  input.source_id,
                  input.protocol_version,
                  input.total_bytes,
                  input.observed_at
           FROM input
           WHERE input.protocol_version = 2
           UNION ALL
           SELECT input.user_id,
                  input.source_id,
                  input.protocol_version,
                  input.total_bytes,
                  input.observed_at
           FROM input
           JOIN usage_reports
             ON usage_reports.report_id = input.report_id
            AND usage_reports.user_id = input.user_id
            AND usage_reports.source_id = input.source_id
            AND usage_reports.protocol_version = input.protocol_version
            AND usage_reports.total_bytes = input.total_bytes
            AND usage_reports.observed_at = input.observed_at
           WHERE input.protocol_version = 1 AND ${V1_USAGE_REPORT_NOT_SUPERSEDED}
         )
         INSERT INTO usage_report_sources(
           user_id, source_id, protocol_version,
           last_total_bytes, accumulated_bytes, observed_at, updated_at
         )
         SELECT user_id, source_id, protocol_version,
                total_bytes, total_bytes, observed_at, ?
         FROM accepted
         WHERE true
         ON CONFLICT(user_id, source_id) DO UPDATE SET
           accumulated_bytes = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.accumulated_bytes, excluded.last_total_bytes)
             WHEN excluded.last_total_bytes >= usage_report_sources.last_total_bytes
               THEN usage_report_sources.accumulated_bytes
                    + (excluded.last_total_bytes - usage_report_sources.last_total_bytes)
             ELSE usage_report_sources.accumulated_bytes + excluded.last_total_bytes
           END,
           last_total_bytes = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.last_total_bytes, excluded.last_total_bytes)
             ELSE excluded.last_total_bytes
           END,
           observed_at = CASE
             WHEN usage_report_sources.source_id = ''
               THEN MAX(usage_report_sources.observed_at, excluded.observed_at)
             WHEN excluded.protocol_version > usage_report_sources.protocol_version
               THEN excluded.observed_at
             ELSE MAX(usage_report_sources.observed_at, excluded.observed_at)
           END,
           protocol_version = MAX(
             usage_report_sources.protocol_version,
             excluded.protocol_version
           ),
           updated_at = excluded.updated_at
         -- v1 used a node wall clock, so accept a higher cumulative value even
         -- when that clock stepped backwards. The first v2 row replaces that
         -- watermark with the server-roster clock. Thereafter only a strictly
         -- newer v2 observation can move this source: report IDs are pruned, and
         -- accepting an old high-water row after a reset would rebill history.
         WHERE (
              usage_report_sources.source_id = ''
              AND excluded.last_total_bytes > usage_report_sources.last_total_bytes
            )
            OR excluded.protocol_version > usage_report_sources.protocol_version
            OR (
              excluded.protocol_version = usage_report_sources.protocol_version
              AND (
                excluded.observed_at > usage_report_sources.observed_at
                OR (
                  excluded.protocol_version = 1
                  AND excluded.last_total_bytes > usage_report_sources.last_total_bytes
                )
              )
            )`,
        ).bind(encodedReports, receivedAt),
        e.DB.prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reportId') AS report_id,
             json_extract(value, '$.userId') AS user_id,
             json_extract(value, '$.sourceId') AS source_id,
             CAST(json_extract(value, '$.protocolVersion') AS INTEGER) AS protocol_version,
             CAST(json_extract(value, '$.totalBytes') AS INTEGER) AS total_bytes,
             CAST(json_extract(value, '$.observedAt') AS INTEGER) AS observed_at
           FROM json_each(?)
         ),
         accepted_reports AS (
           SELECT input.user_id
           FROM input
           WHERE input.protocol_version = 2
           UNION ALL
           SELECT input.user_id
           FROM input
           JOIN usage_reports
             ON usage_reports.report_id = input.report_id
            AND usage_reports.user_id = input.user_id
            AND usage_reports.source_id = input.source_id
            AND usage_reports.protocol_version = input.protocol_version
            AND usage_reports.total_bytes = input.total_bytes
            AND usage_reports.observed_at = input.observed_at
           WHERE input.protocol_version = 1
         ),
         accepted AS (
           SELECT DISTINCT user_id FROM accepted_reports
         ),
         effective AS (
           SELECT accepted.user_id,
                  CASE rollout.phase
                    WHEN 'dual' THEN CASE
                      WHEN EXISTS (
                        SELECT 1 FROM usage_report_sources legacy
                        WHERE legacy.user_id = accepted.user_id
                          AND legacy.source_id = ''
                      ) THEN COALESCE((
                        SELECT accumulated_bytes FROM usage_report_sources legacy
                        WHERE legacy.user_id = accepted.user_id
                          AND legacy.source_id = ''
                      ), 0)
                      ELSE COALESCE((
                        SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                        WHERE named.user_id = accepted.user_id
                          AND named.source_id != ''
                      ), 0)
                    END
                    ELSE CASE
                      WHEN baseline.user_id IS NOT NULL THEN
                        baseline.reported_bytes + MAX(
                          0,
                          COALESCE((
                            SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                            WHERE named.user_id = accepted.user_id
                              AND named.source_id != ''
                          ), 0) - baseline.named_bytes
                        )
                      ELSE COALESCE((
                        SELECT SUM(accumulated_bytes) FROM usage_report_sources named
                        WHERE named.user_id = accepted.user_id
                          AND named.source_id != ''
                      ), 0)
                    END
                  END AS total_bytes
           FROM accepted
           CROSS JOIN usage_metering_rollout rollout
           LEFT JOIN usage_metering_cutover_baselines baseline
             ON baseline.user_id = accepted.user_id
           WHERE rollout.singleton_id = 1
         )
         UPDATE users
         SET usage_reported_bytes = MAX(
               usage_reported_bytes,
               COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
             ),
             usage_bytes = MAX(
               0,
               MAX(
                 usage_reported_bytes,
                 COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
               ) - usage_baseline_bytes
             ),
             updated_at = ?
         WHERE id IN (SELECT user_id FROM effective)
           AND (
             usage_reported_bytes < COALESCE(
               (SELECT total_bytes FROM effective WHERE user_id = users.id), 0
             )
             OR usage_bytes != MAX(
               0,
               MAX(
                 usage_reported_bytes,
                 COALESCE((SELECT total_bytes FROM effective WHERE user_id = users.id), 0)
               ) - usage_baseline_bytes
             )
           )`,
        ).bind(encodedReports, receivedAt),
      ]);
    } catch (x) {
      if (String(x).includes('USAGE_REPORT_CONFLICT')) {
        throw new ApiError(409, 'USAGE_REPORT_CONFLICT', 'reportId was already used with different content');
      }
      if (String(x).includes('USAGE_METERING_V2_REQUIRED')) {
        throw new ApiError(409, 'METERING_V2_REQUIRED', 'Metering rollout now requires named protocol v2');
      }
      throw x;
    }

    const ineligibleUsers = await e.DB.prepare(
      `WITH input AS (
         SELECT DISTINCT json_extract(value, '$.userId') AS user_id
         FROM json_each(?)
       )
       SELECT users.id
       FROM users JOIN input ON input.user_id = users.id
       WHERE users.status != 'active'
          OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
          OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)`,
    ).bind(encodedReports, receivedAt).all<Row>();
    for (const user of ineligibleUsers.results) {
      await enforceUser(e, user.id, false);
    }
    if (ineligibleUsers.results.length > 0) await processRevocations(e);
    return Response.json({ accepted: reports.length, uniqueReports: unique.size });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found');
}

export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext) {
    const releaseResponse = await handleReleaseHost(req, e);
    if (releaseResponse) return releaseResponse;

    const origin = req.headers.get('origin');
    const url = new URL(req.url);
    const path = url.pathname;
    const secure = (r: Response, includeCors = true) => {
      const h = new Headers(r.headers);
      const isOpsUi = path === '/ops' || path.startsWith('/ops/') || path === '/ops2' || path.startsWith('/ops2/');
      h.set(
        'content-security-policy',
        isOpsUi
          // style-src needs 'unsafe-inline': the console draws meter widths
          // with React style attributes. Scripts stay 'self'-only.
          ? "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'"
          : "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'",
      );
      h.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
      h.set('referrer-policy', 'no-referrer');
      h.set('x-content-type-options', 'nosniff');
      h.set('x-frame-options', 'DENY');
      if (path.startsWith('/api/') || path === '/' || path === '/ops' || path === '/ops/' || path === '/ops2' || path === '/ops2/' || path.endsWith('.html')) {
        h.set('cache-control', 'no-store');
      }
      if (includeCors && origin) {
        h.set('access-control-allow-origin', origin);
        h.append('vary', 'Origin');
      }
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    };
    if (origin && origin !== e.ALLOWED_ORIGIN) {
      return secure(error(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed')), false);
    }
    const isOperationsPath = path === '/ops' || path.startsWith('/ops/') || path === '/ops2' || path.startsWith('/ops2/') || path.startsWith('/api/v1/ops/');
    if (req.method === 'OPTIONS' && !isOperationsPath) {
      return secure(new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type',
          'access-control-max-age': '86400',
        },
      }));
    }
    try {
      if (path === '/ops' || path.startsWith('/ops/') || path === '/ops2' || path.startsWith('/ops2/')) {
        await operationsAdmin(req, e);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return secure(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }));
        }
        const redirect = opsConsoleRedirect(url);
        if (redirect || path.startsWith('/ops2/')) return secure(new Response(null, { status: redirect ? 302 : 404, headers: redirect ? { location: redirect } : undefined }));
        return secure(await e.ASSETS.fetch(req));
      }
      if (
        path === '/' ||
        path === '/index.html' ||
        path === '/admin.js' ||
        path === '/style.css'
      ) {
        return secure(Response.json(
          { error: { code: 'NOT_FOUND', message: 'This host is the Tono API' } },
          { status: 404 },
        ), false);
      }
      return secure(
        path.startsWith('/api/')
          ? await route(req, e, ctx)
          : await e.ASSETS.fetch(req),
      );
    } catch (x) {
      return secure(error(x));
    }
  },
  async scheduled(_controller: ScheduledController, e: Env, ctx: ExecutionContext) {
    ctx.waitUntil(enforceAll(e, { enforceUser, expirePending, processRevocations, tailscale }));
  },
} satisfies ExportedHandler<Env>;
