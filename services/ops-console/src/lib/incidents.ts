import type {
  CarrierKey,
  CustomerSummaryDto,
  IncidentDto,
  IncidentEvidenceDto,
  JobType,
  NodeVerdict,
  Severity,
} from '@contract';
import { copy } from '@/copy/copy';
import { formatCount, formatLatency, formatLoss, formatPercent, formatWhenAgo } from './display';

const SEVERITY_RANK: Record<Severity, number> = { severe: 0, warn: 1, notice: 2 };

/**
 * 进行中: anything the operator has not finished with. An acked incident is
 * still open — someone claimed it, the node is still blocked — and a snoozed
 * one is open too, just quiet. Only 已恢复 leaves this list, and it leaves it
 * because the engine measured the subject healthy again, not because a human
 * clicked something.
 */
export function openIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return sortIncidents(rows.filter((row) => row.status !== 'resolved'));
}

export function resolvedIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return rows
    .filter((row) => row.status === 'resolved')
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
}

/** Severity, then blast radius, then how long it has been going on. */
export function sortIncidents(rows: readonly IncidentDto[]): IncidentDto[] {
  return [...rows].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || b.impactCount - a.impactCount
    || a.openedAt - b.openedAt
  ));
}

/**
 * How many customers are actually affected right now.
 *
 * Children are skipped: thirty customers behind one blocked node open thirty
 * incidents that all roll up to the node's, and adding their impact to its
 * own would report sixty-odd people hurt by a fault that hit thirty.
 */
export function impactedCustomers(rows: readonly IncidentDto[]): number {
  return openIncidents(rows)
    .filter((row) => row.parentIncidentId === null)
    .reduce((sum, row) => sum + row.impactCount, 0);
}

export function lastResolvedAt(rows: readonly IncidentDto[]): number | null {
  const [newest] = resolvedIncidents(rows);
  return newest?.resolvedAt ?? null;
}

/** The children of an open node incident — the 受影响客户 list in the drawer. */
export function childrenOf(rows: readonly IncidentDto[], id: string): IncidentDto[] {
  return sortIncidents(rows.filter((row) => row.parentIncidentId === id));
}

/**
 * What the row is about, in the words the operator uses for it.
 *
 * A node incident is about a node and its name is already the name; a customer
 * incident carries the internal user id, which nobody recognises. Resolving it
 * to the address — through the same masker the privacy toggle uses — is the
 * difference between "u-04 连不上" and a sentence someone can act on.
 */
export function incidentSubject(
  incident: IncidentDto,
  customers: readonly CustomerSummaryDto[],
  mask: (email: string) => string,
): string | null {
  if (incident.subjectType !== 'user' || !incident.subjectId) return incident.subjectId;
  const person = customers.find((row) => row.userId === incident.subjectId);
  return person ? mask(person.email) : incident.subjectId;
}

/* ------------------------------------------------------ 一条事故能做的那件事 */

/**
 * Where the button goes. The three are genuinely different acts, not three
 * flavours of one: a job asks a machine to do something, a jump only moves the
 * reader, and a blocked action does nothing but explain itself.
 */
export type IncidentActionGo = 'job' | 'node' | 'customer' | 'none';

export type IncidentActionSpec = {
  id: string;
  label: string;
  go: IncidentActionGo;
  /** The queue entry, when this action asks the hub for work. */
  jobType: JobType | null;
  /** What the operator will have done, in the customer's terms. */
  consequence: string;
  /** The machine or the person this acts on, already resolved. */
  subjectId: string | null;
  /** Why it cannot be pressed, or `null`. Never a disabled button in silence. */
  blocked: string | null;
};

/**
 * The engine writes `node-blocked`; the older rows in the table say
 * `node_blocked`. One dash's difference decided whether every incident on the
 * page got its action, so the two spellings are folded before anything is
 * matched on them.
 */
function kindOf(incident: IncidentDto): string {
  return incident.kind.trim().toLowerCase().replace(/_/g, '-');
}

function nodeOf(incident: IncidentDto): string | null {
  return incident.subjectType === 'node' && incident.subjectId ? incident.subjectId : null;
}

function userOf(incident: IncidentDto): string | null {
  return incident.subjectType === 'user' && incident.subjectId ? incident.subjectId : null;
}

function nodeJob(
  incident: IncidentDto,
  id: string,
  label: string,
  jobType: JobType,
  consequence: string,
): IncidentActionSpec {
  const name = nodeOf(incident);
  return {
    id,
    label,
    go: 'job',
    jobType,
    consequence,
    subjectId: name,
    blocked: name === null ? copy.incidentActionBlocked.noNode : null,
  };
}

/**
 * The one action worth leading the row with, by what kind of thing broke.
 *
 * Every one of these is the first thing the operator would have done anyway:
 * a machine the wall took gets looked at for unlisting, a machine that went
 * quiet gets measured again from 大陆, a machine that is merely slow gets its
 * own error log pulled, and a customer's incident gets that customer's page.
 * Anything unmapped keeps 认领 as its only action rather than inventing one.
 */
export function incidentAction(incident: IncidentDto): IncidentActionSpec | null {
  const kind = kindOf(incident);
  if (kind === 'node-blocked') {
    const name = nodeOf(incident);
    return {
      id: 'retirePreview',
      label: copy.incidentAction.retirePreview,
      go: 'node',
      jobType: null,
      consequence: copy.incidentRetirePreview,
      subjectId: name,
      blocked: name === null ? copy.incidentActionBlocked.noNode : null,
    };
  }
  if (kind === 'node-down') {
    return nodeJob(
      incident,
      'probe',
      copy.nodeActions.probe,
      'node_probe',
      copy.nodeActionConsequence.probe,
    );
  }
  if (kind === 'node-degraded') {
    return nodeJob(
      incident,
      'pullErrors',
      copy.nodeActions.pullErrors,
      'xray_dial_errors',
      copy.nodeActionConsequence.pullErrors,
    );
  }
  if (kind === 'fleet-collector-stale') {
    return {
      id: 'sources',
      label: copy.incidentAction.sources,
      go: 'none',
      jobType: null,
      consequence: copy.incidentActionBlocked.noSourcesPage,
      subjectId: null,
      blocked: copy.incidentActionBlocked.noSourcesPage,
    };
  }
  if (kind.startsWith('customer-') || kind.startsWith('user-')) {
    const userId = userOf(incident);
    return {
      id: 'openCustomer',
      label: copy.incidentAction.openCustomer,
      go: 'customer',
      jobType: null,
      consequence: copy.incidentAction.openCustomer,
      subjectId: userId,
      blocked: userId === null ? copy.incidentActionBlocked.noCustomer : null,
    };
  }
  return null;
}

/* ----------------------------------------------------------------- 证据 */

const words = copy.evidence;

const QUALITY_WORDS: Record<string, string> = {
  OK: copy.nodeVerdictWord.ok,
  EDGE_OK: copy.nodeVerdictWord.ok,
  LIKELY_BLOCKED: copy.nodeVerdictWord.blocked,
  DOWN: copy.nodeVerdictWord.down,
  EDGE_FAIL: copy.nodeVerdictWord.down,
  DEGRADED: copy.nodeVerdictWord.degraded,
};

function verdictWord(value: unknown): string | null {
  const key = String(value) as NodeVerdict;
  return copy.nodeVerdictWord[key] ?? null;
}

/**
 * The engine's value, read back.
 *
 * It arrives as text because that is how the incident carries it, and every
 * non-string was turned into its own notation on the way out — so a bare
 * `"LIKELY_BLOCKED"` still has its quotes, and a list of carriers is still a
 * list. Parsing it back is the only way this file sees the measurement rather
 * than a rendering of it.
 */
function parsed(value: string): unknown {
  const text = value.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Two decimals at most, trailing zeros gone: a load average reads `0.04`. */
function decimal(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function carrierWord(key: unknown): string {
  const name = String(key) as CarrierKey;
  return copy.nodeCarrier[name] ?? name;
}

function lossLine(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return words.lossNone;
  return value
    .map((entry) => {
      if (!isRecord(entry)) return String(entry);
      const pct = num(entry.lossPct);
      return words.lossOne(carrierWord(entry.key), pct === null ? copy.missing : formatLoss(pct));
    })
    .join(' · ');
}

function machineLine(value: unknown): string {
  if (!isRecord(value)) return copy.missing;
  const load = num(value.load1);
  const mem = num(value.memRatio);
  const parts = [words.machine(
    load === null ? copy.missing : decimal(load),
    mem === null ? copy.missing : formatPercent(mem),
  )];
  const cpu = num(value.cpu);
  // The engine reports CPU as a percentage already and the ratios as ratios;
  // dividing one of them by a hundred here is how a busy box reads as idle.
  if (cpu !== null) parts.push(words.machineCpu(formatPercent(cpu / 100)));
  const disk = num(value.diskRatio);
  if (disk !== null) parts.push(words.machineDisk(formatPercent(disk)));
  return parts.join(' · ');
}

function failsLine(value: unknown): string {
  if (!isRecord(value)) return copy.missing;
  return words.fails(
    formatCount(num(value.failures) ?? 0),
    formatCount(num(value.attempts) ?? 0),
    formatCount(num(value.distinctUsers) ?? 0),
  );
}

function boolWord(value: unknown, yes: string, no: string, unknown: string): string {
  if (value === true) return yes;
  if (value === false) return no;
  return unknown;
}

function stampLine(value: unknown, said: (when: string) => string, never: string): string {
  const at = num(value);
  return at === null ? never : said(formatWhenAgo(at));
}

/** Anything the engine started writing since: its own name, and a value a person can read. */
function plain(value: unknown): string {
  if (value === null || value === undefined) return copy.missing;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (typeof value === 'number') return decimal(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plain).join(' · ');
  if (isRecord(value)) {
    return Object.entries(value).map(([key, nested]) => words.other(key, plain(nested))).join(' · ');
  }
  return copy.missing;
}

/**
 * One measurement, as a sentence.
 *
 * The label is the key the engine wrote, which is why the mapping is on the
 * label rather than on the incident's kind: the same `loss` means the same
 * thing under a blocked node and under a slow customer. A key nobody has
 * mapped yet keeps its own name and gets a readable value — never a brace.
 */
export function evidenceSentence(row: IncidentEvidenceDto): string {
  const value = parsed(row.value);
  switch (row.label) {
    case 'blockStatus': {
      const word = QUALITY_WORDS[String(value)];
      return word ? words.scan(word) : words.scan(plain(value));
    }
    case 'observed':
      return words.observedNow(verdictWord(value) ?? plain(value));
    case 'verdict':
      return words.verdictNow(verdictWord(value) ?? plain(value));
    case 'ok':
      return boolWord(value, words.exitUp, words.exitDown, words.exitUnknown);
    case 'agentObservedAt':
      return stampLine(value, words.agentHeard, words.agentSilent);
    case 'qualitySweepAt':
      return stampLine(value, words.scanAt, words.scanNever);
    case 'agentsSnapshotAt':
      return stampLine(value, words.agentsAt, words.agentsNever);
    case 'loss':
      return lossLine(value);
    case 'machine':
      return machineLine(value);
    case 'fails30m':
      return failsLine(value);
    case 'handshakeDistinctUsers':
      return words.handshake(formatCount(num(value) ?? 0));
    case 'errorSpike':
      return boolWord(value, words.errorSpikeYes, words.errorSpikeNo, words.errorSpikeNo);
    case 'occupancy':
      return words.occupancy(formatCount(num(value) ?? 0));
    case 'catalogListed':
      return boolWord(value, words.listedYes, words.listedNo, words.listedUnknown);
    case 'selectedServer':
      return words.onNode(value === null ? copy.missing : plain(value));
    case 'delayMs': {
      const ms = num(value);
      return words.delay(ms === null ? copy.missing : formatLatency(ms));
    }
    case 'pathStreak':
      return words.streak(formatCount(num(value) ?? 0));
    case 'failures':
      return words.failCount(formatCount(num(value) ?? 0));
    case 'lastFailAt':
      return stampLine(value, words.lastFail, copy.missing);
    case 'lastOkAt':
      return stampLine(value, words.lastOk, copy.missing);
    case 'switches24h':
      return words.switches(formatCount(num(value) ?? 0));
    default:
      return words.other(row.label, plain(value));
  }
}
