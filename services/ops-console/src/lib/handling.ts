import type {
  CustomerSummaryDto,
  IncidentDto,
  IncidentEvidenceDto,
  JobType,
  NodeVerdict,
} from '@contract';
import { copy } from '@/copy/copy';
import { handlingOf, type IncidentClosure } from './api-followups';
import type { Chore } from './chores';
import { nowSec } from './clock';
import { formatWhenAgo } from './display';
import { childrenOf } from './incidents';

/**
 * The half of an incident that is about handling it rather than describing it.
 *
 * It lives beside `incidents.ts` rather than inside it for one boring reason —
 * that file is already at the 400-line budget — and one better one: everything
 * here answers "what do I do, and how will I know it worked", which is a
 * different question from "what happened", and the review's whole complaint
 * was that the console only ever answered the second.
 */

const DAY = 86_400;
const QUARTER_HOUR = 15 * 60;
const HOUR = 3_600;
/** 明早: nine in the morning, tomorrow, in the reader's own timezone. */
const MORNING_HOUR = 9;

function kindOf(incident: IncidentDto): string {
  return incident.kind.trim().toLowerCase().replace(/_/g, '-');
}

function nodeOf(incident: IncidentDto): string | null {
  return incident.subjectType === 'node' && incident.subjectId ? incident.subjectId : null;
}

/* ------------------------------------------------------ 尚未确认的影响 */

export type UnconfirmedImpact = {
  /** Customers the engine has already opened a child incident for. */
  sure: number;
  /** Customers on the same machine whose last word predates the fault. */
  maybe: CustomerSummaryDto[];
  /** Why the second number is not the first, or null when there is no machine. */
  why: string;
};

/**
 * Who else might be hurt and is not counted yet.
 *
 * The engine only opens a customer incident for somebody it has measured
 * failing. A customer parked on the same machine whose client has said nothing
 * since before the fault started has not been measured failing — and has not
 * been measured working either, which is the whole point: reporting "5 位受影响"
 * over a machine twenty people are assigned to is how a console talks an
 * operator out of checking.
 */
export function unconfirmedImpact(
  incident: IncidentDto,
  incidents: readonly IncidentDto[],
  customers: readonly CustomerSummaryDto[],
): UnconfirmedImpact {
  const node = nodeOf(incident);
  const children = childrenOf(incidents, incident.id);
  const counted = new Set(children.map((row) => row.subjectId).filter(Boolean));
  const sure = counted.size;
  if (node === null) {
    return { sure, maybe: [], why: copy.incidentMaybeNotNode };
  }
  const maybe = customers.filter((row) => (
    row.selectedServer === node
    && !counted.has(row.userId)
    && (row.connected.asOfSec === null || row.connected.asOfSec < incident.openedAt)
  ));
  return {
    sure,
    maybe,
    why: maybe.length === 0 ? copy.incidentMaybeNone : copy.incidentMaybeWhy,
  };
}

/* --------------------------------------------------------- 推荐下一步 */

/**
 * The sequence, where the review wrote one.
 *
 * Only 劣化 has extra lines, and they are there because the obvious action is
 * the wrong one: a single carrier's loss figure is a measurement, not a
 * verdict, and the review asked for it to be checked against real customer
 * failures before anybody is migrated off the machine.
 */
export function nextSteps(incident: IncidentDto): readonly string[] {
  return kindOf(incident) === 'node-degraded' ? copy.incidentDegradedSteps : [];
}

/* --------------------------------------------------------------- 复测 */

export type RecheckSpec = {
  jobType: JobType;
  node: string;
  consequence: string;
} | null;

/**
 * How this kind of fault is measured again.
 *
 * A blocked or silent machine is re-measured from 大陆; a machine that is
 * merely slow has its own dial errors pulled, which is the measurement its
 * verdict was made from. Anything else has no probe of its own, and says so
 * rather than offering a button that changes nothing.
 */
export function recheckSpec(incident: IncidentDto): RecheckSpec {
  const node = nodeOf(incident);
  if (node === null) return null;
  const kind = kindOf(incident);
  if (kind === 'node-blocked' || kind === 'node-down') {
    return {
      jobType: 'node_probe',
      node,
      consequence: copy.incidentRecheckConsequence(node),
    };
  }
  if (kind === 'node-degraded') {
    return {
      jobType: 'xray_dial_errors',
      node,
      consequence: copy.incidentRecheckConsequence(node),
    };
  }
  return null;
}

/* --------------------------------------------------------- 下次检查 */

export type CheckPreset = { id: keyof typeof copy.incidentNextCheckPreset; at: number };

export function checkPresets(now = nowSec()): CheckPreset[] {
  const morning = new Date(now * 1_000);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  const at = Math.floor(morning.getTime() / 1_000);
  return [
    { id: 'quarter', at: now + QUARTER_HOUR },
    { id: 'hour', at: now + HOUR },
    { id: 'morning', at: at > now ? at : at + DAY },
  ];
}

/* -------------------------------------------------------------- 收尾 */

/** The engine's words that still mean something is wrong. */
const ALARMING: NodeVerdict[] = ['down', 'blocked', 'degraded', 'pressure'];

const QUALITY_LABELS = ['verdict', 'observed', 'blockStatus'];

const TOKEN_VERDICT: Record<string, NodeVerdict> = {
  OK: 'ok',
  EDGE_OK: 'ok',
  LIKELY_BLOCKED: 'blocked',
  DOWN: 'down',
  EDGE_FAIL: 'down',
  DEGRADED: 'degraded',
  PRESSURE: 'pressure',
};

function parsed(value: string): string {
  const text = value.trim();
  if (text === '') return '';
  try {
    const read = JSON.parse(text) as unknown;
    return typeof read === 'string' ? read : String(read);
  } catch {
    return text;
  }
}

function verdictOf(row: IncidentEvidenceDto): NodeVerdict | null {
  const token = parsed(row.value);
  const direct = TOKEN_VERDICT[token];
  if (direct) return direct;
  const lower = token.toLowerCase() as NodeVerdict;
  return lower in copy.nodeVerdictWord ? lower : null;
}

/** The newest of the evidence rows that carry a verdict, or null. */
function newestVerdict(incident: IncidentDto): { verdict: NodeVerdict; asOfSec: number | null } | null {
  let best: { verdict: NodeVerdict; asOfSec: number | null } | null = null;
  for (const row of incident.evidence) {
    if (!QUALITY_LABELS.includes(row.label)) continue;
    const verdict = verdictOf(row);
    if (verdict === null) continue;
    if (best === null || (row.asOfSec ?? 0) >= (best.asOfSec ?? 0)) best = { verdict, asOfSec: row.asOfSec };
  }
  return best;
}

export type RecoveryProof = {
  /** Whether 已验证恢复 may be chosen at all. */
  ok: boolean;
  /** Why it may not be, in words the operator can act on. Null when it may. */
  reason: string | null;
  /** The measurement being judged, so the drawer can print it beside 事故开始. */
  measuredAt: number;
};

/**
 * Whether the engine has actually measured this thing well again.
 *
 * Two conditions, both necessary. The measurement has to be newer than the
 * fault — an incident closed on a reading taken before it opened is closed on
 * nothing — and its verdict has to have stopped being an alarm. Failing
 * either, 已验证恢复 is refused with the reason, and the operator still has
 * 误报 and 人工结束跟进, which say true things.
 */
export function recoveryProof(incident: IncidentDto): RecoveryProof {
  const measuredAt = incident.lastSeenAt;
  if (measuredAt <= incident.openedAt) {
    return {
      ok: false,
      reason: copy.incidentClosureBlocked.stale(formatWhenAgo(measuredAt)),
      measuredAt,
    };
  }
  const newest = newestVerdict(incident);
  if (newest === null) {
    return { ok: false, reason: copy.incidentClosureBlocked.unmeasured, measuredAt };
  }
  if (ALARMING.includes(newest.verdict)) {
    return {
      ok: false,
      reason: copy.incidentClosureBlocked.alarming(copy.nodeVerdictWord[newest.verdict]),
      measuredAt,
    };
  }
  return { ok: true, reason: null, measuredAt };
}

/** The word a closed incident's row carries. An unrecorded closure reads 已恢复. */
export function closureWord(incident: IncidentDto): string {
  const { closure } = handlingOf(incident);
  return copy.incidentClosureWord[closure ?? 'verified'];
}

/**
 * 最近恢复 counts recoveries, and a 误报 is not one.
 *
 * The tab still lists the mistaken ones — hiding them would lose the record of
 * a rule that fires wrongly — but they are excluded from the number, because a
 * count that includes them is a claim about repairs that never happened.
 */
export function recoveredCount(rows: readonly IncidentDto[]): number {
  return rows.filter((row) => handlingOf(row).closure !== 'false_positive').length;
}

/** Which closures may be chosen, and why one of them may not. */
export function closureReasonNeeded(closure: IncidentClosure): boolean {
  return closure !== 'verified';
}

/* -------------------------------------------------------------- 早报 */

/** Whether a chore falls due before tonight — the 今天必须做 half of the digest. */
export function choresDueToday(rows: readonly Chore[], now = nowSec()): Chore[] {
  const end = endOfDay(now);
  return rows.filter((row) => row.dueAt !== null && row.dueAt <= end);
}

export function endOfDay(now: number): number {
  const date = new Date(now * 1_000);
  date.setHours(23, 59, 59, 0);
  return Math.floor(date.getTime() / 1_000);
}

/** Local noon: after it, the morning read is yesterday's news and folds away. */
const NOON = 12;

export function beforeNoon(now = nowSec()): boolean {
  return new Date(now * 1_000).getHours() < NOON;
}
