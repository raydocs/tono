// I/O around the pure verdict engine: persist, map transitions into the
// shape the alert outbox expects, and run a scoped pass. Fact loading lives
// in ./verdict-facts.

import { type Env, type Row } from '../env';
import {
  type AlertRule,
  type IncidentTransition as AlertTransition,
  planDeliveries,
  sendPending,
  type FetchImpl,
} from './alerts';
import {
  persistNodeStates,
  reconcileIncidents,
  type IncidentTransition as EvaluateTransition,
} from './evaluate';
import { evaluate } from './verdict';
import {
  type CustomerScope,
  buildVerdictInput,
  liveDesires,
  persistPathStreaks,
} from './verdict-facts';
import { customerDesires } from './verdict-customers';

const ID_CHUNK = 90;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function toAlertTransitions(
  db: D1Database,
  transitions: EvaluateTransition[],
): Promise<AlertTransition[]> {
  const usable = transitions.filter(
    (t): t is EvaluateTransition & { transition: AlertTransition['transition'] } =>
      t.transition === 'open' || t.transition === 'escalate' || t.transition === 'resolve',
  );
  if (usable.length === 0) return [];
  try {
    const ids = [...new Set(usable.map((t) => t.incidentId))];
    // D1 caps bound parameters per statement; a fleet-wide outage can open
    // more incidents than that in one pass, and the alerts for the largest
    // outages are the ones that must not be lost.
    const byId = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = await db.prepare(
        `SELECT * FROM ops_incidents WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk).all<Row>();
      for (const row of rows.results ?? []) byId.set(String(row.id), row);
    }
    const out: AlertTransition[] = [];
    for (const t of usable) {
      const row = byId.get(t.incidentId);
      if (!row) continue;
      out.push({
        incidentId: t.incidentId,
        dedupeKey: t.dedupeKey,
        transition: t.transition,
        severity: t.severity,
        kind: String(row.kind),
        subjectType: String(row.subject_type),
        subjectId: String(row.subject_id),
        title: String(row.title),
        detail: row.detail == null ? '' : String(row.detail),
        openedAt: Number(row.opened_at),
        impactCount: Number(row.impact_count) || 0,
      });
    }
    return out;
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function loadEnabledAlertRules(db: D1Database): Promise<AlertRule[]> {
  try {
    const rows = await db.prepare(
      'SELECT * FROM ops_alert_rules WHERE enabled = 1',
    ).all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      enabled: Number(row.enabled),
      matchKind: row.match_kind == null ? null : String(row.match_kind),
      matchSubjectType: row.match_subject_type == null ? null : String(row.match_subject_type),
      matchSubjectId: row.match_subject_id == null ? null : String(row.match_subject_id),
      minSeverity: row.min_severity as AlertRule['minSeverity'],
      minImpact: Number(row.min_impact) || 0,
      fireOn: row.fire_on as AlertRule['fireOn'],
      delaySeconds: Number(row.delay_seconds) || 0,
      cooldownSeconds: Number(row.cooldown_seconds) || 0,
      channel: row.channel as AlertRule['channel'],
      target: String(row.target),
      template: row.template as AlertRule['template'],
      secretRef: row.secret_ref == null ? null : String(row.secret_ref),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

function envSecret(e: Env, ref: string): string | undefined {
  const value = (e as unknown as Record<string, unknown>)[ref];
  return typeof value === 'string' && value.length ? value : undefined;
}

export async function planAndSendAlerts(
  e: Env,
  transitions: AlertTransition[],
  nowSec: number,
  fetchImpl: FetchImpl = fetch,
): Promise<{ planned: number; sent: number; failed: number }> {
  const rules = await loadEnabledAlertRules(e.DB);
  const planned = await planDeliveries(e.DB, transitions, rules, nowSec);
  const secrets: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.secretRef) continue;
    const value = envSecret(e, rule.secretRef);
    if (value) secrets[rule.secretRef] = value;
  }
  const sent = await sendPending(e.DB, {
    secrets,
    allowedHosts: e.ALERT_WEBHOOK_ALLOWED_HOSTS ?? 'api.telegram.org,open.feishu.cn,hooks.slack.com',
    consoleUrl: 'https://admin.afk.ccwu.cc/ops2/',
    resendApiKey: e.RESEND_API_KEY,
    emailFrom: e.EMAIL_FROM,
    incidents: transitions,
  }, fetchImpl, nowSec, 5);
  return { planned: planned.pending, sent: sent.sent, failed: sent.failed };
}

export async function runVerdictPass(
  e: Env,
  nowSec: number,
  scope: CustomerScope = 'all',
): Promise<{ nodes: number; transitions: AlertTransition[] }> {
  const input = await buildVerdictInput(e, nowSec, scope);
  if (typeof scope === 'object') {
    // One customer, judged against the node incidents already on record;
    // every other incident is carried through untouched.
    const userId = scope.userId;
    const carried = await liveDesires(
      e.DB,
      (row) => !(row.subject_type === 'user' && row.subject_id === userId),
    );
    const nodeDesires = carried.filter((d) => d.subjectType !== 'user');
    const customers = customerDesires(input.customers, nowSec, nodeDesires, input.maintenance);
    await persistPathStreaks(e.DB, customers.pathStreaks);
    const raw = await reconcileIncidents(e.DB, [...customers.desires, ...carried], nowSec);
    return { nodes: 0, transitions: await toAlertTransitions(e.DB, raw) };
  }
  const output = evaluate(input);
  let desires = output.desires;
  if (scope === 'none') {
    desires = [
      ...output.desires.filter((d) => d.subjectType !== 'user'),
      ...await liveDesires(e.DB, (row) => row.subject_type === 'user'),
    ];
  }
  await persistNodeStates(e.DB, output, nowSec);
  if (scope !== 'none') await persistPathStreaks(e.DB, output.pathStreaks);
  const raw = await reconcileIncidents(e.DB, desires, nowSec);
  return { nodes: output.nodes.length, transitions: await toAlertTransitions(e.DB, raw) };
}

export async function runNodeVerdictPass(e: Env, nowSec: number) {
  return runVerdictPass(e, nowSec, 'none');
}

export async function runCustomerVerdictPass(e: Env, userId: string, nowSec: number) {
  return runVerdictPass(e, nowSec, { userId });
}
