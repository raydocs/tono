// The words the console is allowed to say, and the only place they are defined.
//
// Three axes never merge into one column: 健康 (one coloured word), 生命周期
// (a neutral tag) and 待办 (always the `rem` tone, never an incident). A node
// that is both blocked and out of quota shows one health word and one chore,
// not six labels — that stacking is what made the old fleet cards unreadable.
//
// This module imports nothing. See ./checkers.ts for why that matters.

/** Who measured a number. Every rendered figure carries one; see `Measured`. */
export const SOURCE_IDS = [
  'collector',
  'komari',
  'telemetry',
  'catalog',
  'profile',
  'engine',
  'jobs',
  'manual',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * A number (or any value) plus the two questions an operator always asks of
 * it: when was it measured, and by whom.
 *
 * `asOfSec === null` means "never measured" — the console renders `—` and the
 * source word, never `0`. A fresh zero and a missing measurement look
 * identical once they reach a chart, which is how "高丢包 2" and "高丢包 8"
 * ended up on two pages of the same dashboard.
 */
export interface Measured<T> {
  value: T;
  asOfSec: number | null;
  source: SourceId;
}

/** Client platforms. A first-class field on devices, windows, events and jobs. */
export const PLATFORMS = ['macos', 'windows', 'linux', 'android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Node verdicts, listed in the engine's precedence order: the first one whose
 * evidence holds wins. A dead box fails every probe including the mainland
 * ones, so `down` must outrank `blocked` or every crashed VPS is reported as
 * censorship.
 */
export const NODE_VERDICTS = [
  'down',
  'blocked',
  'no_probe',
  'degraded',
  'pressure',
  'unknown',
  'ok',
] as const;
export type NodeVerdict = (typeof NODE_VERDICTS)[number];

export const NODE_HEALTH_WORDS = ['失联', '被墙', '劣化', '正常', '未测'] as const;
export type NodeHealthWord = (typeof NODE_HEALTH_WORDS)[number];

/**
 * Customer verdicts in precedence order. `ok` requires fresh positive
 * evidence: silence is `unreported`, not health (R1 — missing data is never
 * green).
 */
export const CUSTOMER_VERDICTS = ['unreachable', 'unstable', 'unreported', 'offline', 'ok'] as const;
export type CustomerVerdict = (typeof CUSTOMER_VERDICTS)[number];

export const CUSTOMER_HEALTH_WORDS = ['连不上', '不稳', '未上报', '离线', '正常'] as const;
export type CustomerHealthWord = (typeof CUSTOMER_HEALTH_WORDS)[number];

/** The six palette roles. Colour never carries meaning alone (R5). */
export const TONES = ['sev', 'warn', 'rem', 'info', 'ok', 'unk'] as const;
export type Tone = (typeof TONES)[number];

/** 在售 / 已下架 / 已退役 — an inventory fact, never coloured. */
export const NODE_LIFECYCLES = ['listed', 'unlisted', 'retired'] as const;
export type NodeLifecycle = (typeof NODE_LIFECYCLES)[number];

/** 在用 / 已停用 / 已到期 — likewise neutral. */
export const CUSTOMER_LIFECYCLES = ['active', 'suspended', 'expired'] as const;
export type CustomerLifecycle = (typeof CUSTOMER_LIFECYCLES)[number];

export const SEVERITIES = ['severe', 'warning', 'notice'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'acked', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** What an incident, chore or job is about. */
export const SUBJECT_TYPES = ['node', 'user', 'home_exit', 'fleet'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * The closed job enum. The hub executor rejects anything not on this list, so
 * adding a member here is half of adding a capability — the other half is a
 * handler on the collector.
 */
export const JOB_TYPES = [
  'xray_dial_errors',
  'xray_error_digest',
  'collect_quality',
  'node_probe',
  'node_config_snapshot',
  'xray_restart',
  'identity_sync',
  'agent_reinstall',
  'catalog_retire',
  'catalog_relist',
  'home_line_probe',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled', 'expired'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_EXECUTORS = ['hub', 'exit_agent', 'worker'] as const;
export type JobExecutor = (typeof JOB_EXECUTORS)[number];

/**
 * The channels that exist today: CI qualifies a `candidate` build and
 * `windows-update-promote` promotes it to `stable`. Named after what the
 * release pipeline already does rather than a generic beta/canary ladder —
 * a channel nothing publishes to would be a column of zeros on the adoption
 * matrix, which is exactly the reading 未发布 exists to prevent.
 */
export const RELEASE_CHANNELS = ['stable', 'candidate'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** Where an alert goes. The rendering template is a separate axis. */
export const ALERT_CHANNELS = ['webhook', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_TEMPLATES = ['telegram', 'feishu', 'slack', 'generic'] as const;
export type AlertTemplate = (typeof ALERT_TEMPLATES)[number];

/** The mainland carriers probed on both directions of the path. */
export const CARRIER_KEYS = ['unicom', 'telecom', 'mobile'] as const;
export type CarrierKey = (typeof CARRIER_KEYS)[number];

/** Where a connection went. 云出口 / 家宽 / 直连 / 拒绝. */
export const ROUTE_KINDS = ['cloud', 'residential', 'direct', 'blocked'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

/** Fixed service families. Facebook Muse counts as `meta`. */
export const SERVICE_FAMILIES = ['claude', 'chatgpt', 'grok', 'gemini', 'meta', 'other'] as const;
export type ServiceFamily = (typeof SERVICE_FAMILIES)[number];

/** `?range=` values. Anything else is a 400, not a silent clamp. */
export const RANGE_KEYS = ['24h', '7d', '30d', '90d'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/**
 * Client event kinds worth keeping. The client emits more; the flattener's
 * allow-list is what stops one bad release from writing four million rows a
 * day, so this union is deliberately closed.
 */
export const CONNECTION_EVENT_KINDS = [
  'connectBegin',
  'connectOk',
  'connectFail',
  'nodeSwitch',
  'connectCatalogFailover',
  'healthProbeFail',
  'protectedOffline',
  'coreRestart',
  'reconnectScheduled',
  'networkChange',
  'disconnectOk',
  'releaseFail',
  'syncFail',
] as const;
export type ConnectionEventKind = (typeof CONNECTION_EVENT_KINDS)[number];

const NODE_WORD_BY_VERDICT: Record<NodeVerdict, { word: NodeHealthWord; tone: Tone }> = {
  down: { word: '失联', tone: 'sev' },
  blocked: { word: '被墙', tone: 'sev' },
  degraded: { word: '劣化', tone: 'warn' },
  pressure: { word: '劣化', tone: 'warn' },
  no_probe: { word: '未测', tone: 'unk' },
  unknown: { word: '未测', tone: 'unk' },
  ok: { word: '正常', tone: 'ok' },
};

/**
 * The one health word for a node.
 *
 * `degraded` and `pressure` collapse to 劣化 on purpose: an operator acts the
 * same way on both, and the distinction lives in the reason sentence.
 * "需下架" is not a word here — it is a suggested action on a 被墙/失联
 * incident.
 */
export function healthWordForVerdict(verdict: NodeVerdict): { word: NodeHealthWord; tone: Tone } {
  return NODE_WORD_BY_VERDICT[verdict] ?? { word: '未测', tone: 'unk' };
}

const CUSTOMER_WORD_BY_VERDICT: Record<CustomerVerdict, { word: CustomerHealthWord; tone: Tone }> = {
  unreachable: { word: '连不上', tone: 'sev' },
  unstable: { word: '不稳', tone: 'warn' },
  unreported: { word: '未上报', tone: 'unk' },
  offline: { word: '离线', tone: 'info' },
  ok: { word: '正常', tone: 'ok' },
};

/**
 * The one health word for a customer.
 *
 * Takes a verdict rather than raw facts: the thresholds (three failures in
 * thirty minutes, four node switches in a day) are policy and belong to
 * `verdict.ts`, which is versioned and shadow-tested. The contract only owns
 * the vocabulary.
 */
export function customerHealthWord(verdict: CustomerVerdict): { word: CustomerHealthWord; tone: Tone } {
  return CUSTOMER_WORD_BY_VERDICT[verdict] ?? { word: '未上报', tone: 'unk' };
}

const TONE_BY_WORD: Record<string, Tone> = {
  失联: 'sev',
  被墙: 'sev',
  连不上: 'sev',
  劣化: 'warn',
  不稳: 'warn',
  未测: 'unk',
  未上报: 'unk',
  离线: 'info',
  正常: 'ok',
};

/**
 * The tone a word always carries. Callers that already have a verdict should
 * use the two helpers above; this exists for rows that arrived carrying only
 * the word (history entries, incident titles).
 */
export function toneFor(word: NodeHealthWord | CustomerHealthWord): Tone {
  return TONE_BY_WORD[word] ?? 'unk';
}
