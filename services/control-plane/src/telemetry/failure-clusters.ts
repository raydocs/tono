// One outage is one open cluster. The engineering webhook fires when a
// cluster opens and, rate-limited, when it later spikes. Both the URL and
// the HMAC secret must be set; either one missing disables the send.
// Payloads never include emails, hostnames, URLs, or full IP addresses.


export const CLUSTER_GAP_MS = 30 * 60 * 1000;
export const ALERT_MIN_GAP_SEC = 15 * 60;
export const SPIKE_MULTIPLE = 5;
export const SPIKE_MIN_GROWTH = 10;
export const ALERT_HOUR_CAP = 12;

const SAMPLE_LIMIT = 500;

/** The user was left without a working network. First event of the cluster
 *  alerts immediately; spike growth is not required. */
export const P0_NETWORK_LOSS_CODES = [
  'TONO_NETWORK_LOSS',
  'TONO_FAIL_OPEN',
  'TONO_WATCHDOG_RESTORE',
  'TONO_KILL_SWITCH_STUCK',
  'TONO_RESTORE_NETWORK',
  'TONO_CRASH_WHILE_PROTECTED',
] as const;

export type ClusterSeverity = 'p0' | 'normal';

export function clusterSeverity(code: string): ClusterSeverity {
  return (P0_NETWORK_LOSS_CODES as readonly string[]).includes(code) ? 'p0' : 'normal';
}

export type ClusterAlert = 'opened' | 'spike';

export type ClusterSnapshot = {
  count: number;
  countAtAlert: number;
  alertedAt: number | null;
  lastSeenMs: number;
};

export function clusterAlertDecision(
  existing: ClusterSnapshot | null,
  nowMs: number,
  nowSec: number,
  severity: ClusterSeverity = 'normal',
): { action: 'open' | 'join'; alert: ClusterAlert | null } {
  if (!existing || nowMs - existing.lastSeenMs > CLUSTER_GAP_MS) {
    return { action: 'open', alert: 'opened' };
  }
  const nextCount = existing.count + 1;
  if (existing.alertedAt == null) return { action: 'join', alert: 'opened' };
  // P0 already alerted on the first event of this cluster. Later events do
  // not wait for a spike and do not send another alert.
  if (severity === 'p0') return { action: 'join', alert: null };
  const since = nowSec - existing.alertedAt;
  const grew = nextCount >= existing.countAtAlert * SPIKE_MULTIPLE
    && nextCount >= existing.countAtAlert + SPIKE_MIN_GROWTH;
  if (grew && since >= ALERT_MIN_GAP_SEC) return { action: 'join', alert: 'spike' };
  return { action: 'join', alert: null };
}

export function isSafeAlertUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host === 'metadata.google.internal' || host === '169.254.169.254') return false;
  if (isIpLiteral(host) && isPrivateOrLinkLocal(host)) return false;
  return true;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function isPrivateOrLinkLocal(host: string): boolean {
  if (host.includes(':')) {
    const lower = host.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export type FailureClusterInput = {
  atMs: number;
  code: string;
  stage: string;
  appVersion: string;
  platform: string;
  node: string;
  userId: string;
  deviceId: string | null;
  channel?: string | null;
};

export type ClusterEnv = {
  FAILURE_ALERT_WEBHOOK_URL?: string;
  FAILURE_ALERT_WEBHOOK_SECRET?: string;
};

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export function webhookConfigured(env: ClusterEnv): { url: string; secret: string } | null {
  const url = env.FAILURE_ALERT_WEBHOOK_URL?.trim() ?? '';
  const secret = env.FAILURE_ALERT_WEBHOOK_SECRET?.trim() ?? '';
  if (!url || !secret || secret.length < 32 || !isSafeAlertUrl(url)) return null;
  return { url, secret };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// What a client-supplied field may be once it leaves the control plane (the
// alert webhook, the read API's sample). A length check is not a class and a
// shape is not provenance: `192.168.257` is a version to a regex and an
// address to a URL parser. So an identifier goes out only as an identifier, an
// enum as an enum, and a name or version only when the server issued it;
// anything else is a placeholder. Ingest stays tolerant (old clients keep
// reporting); only the outbound copy is strict.
const UNCLASSIFIED = '[unclassified]';
const UNLISTED = '[unlisted]';
const OUTBOUND = {
  code: /^[A-Za-z][A-Za-z0-9_]{0,79}$/,
  stage: /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
  platform: /^(?:macos|windows|ios|android|linux|unknown)$/,
  channel: /^(?:release|beta)$/,
} as const;

function outbound(value: unknown, shape: RegExp): string {
  return typeof value === 'string' && shape.test(value) ? value : UNCLASSIFIED;
}

// A catalog display name has spaces and separators no charset can tell from
// prose, so it goes out only if the server issued it.
async function outboundNode(db: D1Database, node: string): Promise<string> {
  const base = node.replace(/ · hy2$/, '');
  const known = await db.prepare(
    `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM exit_nodes WHERE name = ?1)
        OR EXISTS (SELECT 1 FROM operations_logical_nodes WHERE display_name = ?1)`,
  ).bind(base).first<{ ok: number }>();
  return known ? node : UNLISTED;
}

// A version goes out only if the release registry lists it.
async function outboundVersion(db: D1Database, version: string): Promise<string> {
  const known = await db.prepare(
    `SELECT 1 AS ok FROM client_releases WHERE version = ? LIMIT 1`,
  ).bind(version).first<{ ok: number }>();
  return known ? version : UNLISTED;
}

// The release channel only. Client error text and build identifiers cannot be
// proven free of hostnames, addresses or credentials; they stay on the
// failure's own connection_events row and never enter the sample.
export function outboundSample(value: unknown): { channel: string | null } {
  const channel = value && typeof value === 'object' ? (value as { channel?: unknown }).channel : null;
  return { channel: typeof channel === 'string' && OUTBOUND.channel.test(channel) ? channel : null };
}

function sampleOf(input: FailureClusterInput): string {
  return JSON.stringify(outboundSample(input)).slice(0, SAMPLE_LIMIT);
}

type ClusterRow = {
  id: string;
  event_count: number;
  alerted_at: number | null;
  count_at_alert: number;
  last_seen_ms: number;
  first_seen_ms: number;
  user_count: number;
  device_count: number;
  code: string;
  stage: string;
  app_version: string;
  platform: string;
  node: string;
  sample_json: string | null;
};

export async function recordFailureCluster(
  db: D1Database,
  input: FailureClusterInput,
  env: ClusterEnv,
  nowSec: number,
  fetchImpl: FetchImpl = fetch,
): Promise<{ clusterId: string; alerted: boolean }> {
  const nowMs = input.atMs;
  const groupKey = await sha256Hex([
    input.code, input.stage, input.appVersion, input.platform, input.node,
  ].join('\n'));
  await db.prepare(
    `UPDATE failure_clusters SET status = 'quiet', updated_at = ?
     WHERE group_key = ? AND status = 'open' AND ? - last_seen_ms > ?`,
  ).bind(nowSec, groupKey, nowMs, CLUSTER_GAP_MS).run();

  const decisionRow = await db.prepare(
    `SELECT id, event_count, alerted_at, count_at_alert, last_seen_ms, first_seen_ms,
            user_count, device_count, code, stage, app_version, platform, node, sample_json
     FROM failure_clusters WHERE group_key = ? AND status = 'open'`,
  ).bind(groupKey).first<ClusterRow>();

  const snapshot: ClusterSnapshot | null = decisionRow ? {
    count: Number(decisionRow.event_count),
    countAtAlert: Number(decisionRow.count_at_alert),
    alertedAt: decisionRow.alerted_at == null ? null : Number(decisionRow.alerted_at),
    lastSeenMs: Number(decisionRow.last_seen_ms),
  } : null;
  const severity = clusterSeverity(input.code);
  const decision = clusterAlertDecision(snapshot, nowMs, nowSec, severity);
  const sample = sampleOf(input);
  let clusterId: string;
  if (decision.action === 'open' || !decisionRow) {
    clusterId = crypto.randomUUID();
    try {
      await db.prepare(
        `INSERT INTO failure_clusters(
           id, group_key, code, stage, app_version, platform, node, severity,
           event_count, user_count, device_count, first_seen_ms, last_seen_ms,
           sample_json, opened_at, updated_at, alert_count, count_at_alert, status
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?, ?, 0, 0, 'open')`,
      ).bind(
        clusterId, groupKey, input.code, input.stage, input.appVersion, input.platform, input.node,
        severity, nowMs, nowMs, sample, nowSec, nowSec,
      ).run();
    } catch (error) {
      // Two uploads can both observe "no open cluster" and then insert. The
      // partial unique index keeps a single open row; the loser must join it.
      // A 500 here fails the diagnostics POST after earlier events were stored.
      if (!String(error).includes('UNIQUE constraint failed')) throw error;
      const winner = await db.prepare(
        `SELECT id FROM failure_clusters WHERE group_key = ? AND status = 'open'`,
      ).bind(groupKey).first<{ id: string }>();
      if (!winner) throw error;
      clusterId = String(winner.id);
      await db.prepare(
        `UPDATE failure_clusters
         SET event_count = event_count + 1, last_seen_ms = MAX(last_seen_ms, ?), sample_json = ?, updated_at = ?
         WHERE id = ? AND status = 'open'`,
      ).bind(nowMs, sample, nowSec, clusterId).run();
    }
  } else {
    clusterId = decisionRow.id;
    await db.prepare(
      `UPDATE failure_clusters
       SET event_count = event_count + 1, last_seen_ms = MAX(last_seen_ms, ?), sample_json = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(nowMs, sample, nowSec, clusterId).run();
  }

  const deviceId = input.deviceId && input.deviceId.length > 0 ? input.deviceId : '-';
  await db.prepare(
    `INSERT OR IGNORE INTO failure_cluster_members(cluster_id, user_id, device_id) VALUES(?, ?, ?)`,
  ).bind(clusterId, input.userId, deviceId).run();
  await db.prepare(
    `UPDATE failure_clusters SET
       user_count = (SELECT COUNT(DISTINCT user_id) FROM failure_cluster_members WHERE cluster_id = ?),
       device_count = (SELECT COUNT(*) FROM failure_cluster_members WHERE cluster_id = ?)
     WHERE id = ?`,
  ).bind(clusterId, clusterId, clusterId).run();

  const alerted = decision.alert
    ? await sendClusterAlert(db, clusterId, decision.alert, env, nowSec, fetchImpl)
    : false;
  return { clusterId, alerted };
}

async function sendClusterAlert(
  db: D1Database,
  clusterId: string,
  reason: ClusterAlert,
  env: ClusterEnv,
  nowSec: number,
  fetchImpl: FetchImpl,
): Promise<boolean> {
  const hook = webhookConfigured(env);
  if (!hook) return false;
  const recent = await db.prepare(
    `SELECT COUNT(*) AS n FROM failure_alert_sends WHERE sent_at > ?`,
  ).bind(nowSec - 3600).first<{ n: number }>();
  const preview = await db.prepare(
    `SELECT code FROM failure_clusters WHERE id = ?`,
  ).bind(clusterId).first<{ code: string }>();
  const severity = clusterSeverity(preview?.code ?? '');
  // A P0 opening alert is the first time this outage left someone offline.
  // The hourly cap and the spike gap must not swallow it.
  if (severity !== 'p0' && Number(recent?.n ?? 0) >= ALERT_HOUR_CAP) return false;
  const row = await db.prepare(
    `SELECT id, code, stage, app_version, platform, node, event_count, user_count, device_count,
            first_seen_ms, last_seen_ms, sample_json, alerted_at
     FROM failure_clusters WHERE id = ?`,
  ).bind(clusterId).first<ClusterRow>();
  if (!row) return false;
  if (reason === 'spike' && row.alerted_at != null && nowSec - Number(row.alerted_at) < ALERT_MIN_GAP_SEC) {
    return false;
  }
  let sample: { channel: string | null } | null = null;
  try {
    sample = row.sample_json ? outboundSample(JSON.parse(row.sample_json)) : null;
  } catch {
    sample = null;
  }
  const body = JSON.stringify({
    schemaVersion: 1,
    kind: 'failure_cluster',
    severity: clusterSeverity(row.code),
    reason,
    cluster: {
      id: row.id,
      code: outbound(row.code, OUTBOUND.code),
      stage: outbound(row.stage, OUTBOUND.stage),
      appVersion: await outboundVersion(db, row.app_version),
      platform: outbound(row.platform, OUTBOUND.platform),
      node: await outboundNode(db, row.node),
      count: Number(row.event_count),
      users: Number(row.user_count),
      devices: Number(row.device_count),
      firstSeenMs: Number(row.first_seen_ms),
      lastSeenMs: Number(row.last_seen_ms),
      sample,
    },
    detailPath: `/api/v1/diagnostics/clusters/${row.id}`,
  });
  const signature = await hmacHex(hook.secret, `${nowSec}.${body}`);
  try {
    const response = await fetchImpl(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tono-timestamp': String(nowSec),
        'x-tono-signature': `sha256=${signature}`,
      },
      body,
    });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  await db.batch([
    db.prepare(
      `INSERT INTO failure_alert_sends(id, cluster_id, sent_at, reason) VALUES(?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), clusterId, nowSec, reason),
    db.prepare(
      `UPDATE failure_clusters
       SET alerted_at = ?, alert_count = alert_count + 1, count_at_alert = event_count, updated_at = ?
       WHERE id = ?`,
    ).bind(nowSec, nowSec, clusterId),
  ]);
  return true;
}

export async function tokenMatches(presented: string, expected: string): Promise<boolean> {
  if (!presented || !expected) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('tono-diagnostics-read'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sign = async (value: string) => new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(value)),
  );
  const a = await sign(presented);
  const b = await sign(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
