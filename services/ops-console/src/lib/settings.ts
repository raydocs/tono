import type {
  ActorType,
  AlertDeliveryDto,
  CandidateStatus,
  DeliveryStatus,
  DirectCandidateDto,
  HomeLineUsageDayDto,
} from '@contract';
import { CANDIDATE_STATUSES } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatDate } from './display';

/**
 * The nine sections, in rail order. `alerts` is where an unnamed hash lands.
 *
 * The order is the order of consequence rather than of frequency: the three
 * that change what a client fetches next — the node catalogue, the routing
 * rules, and the home inventory both of those draw from — come first, and the
 * bookkeeping an operator does around them follows. 注册白名单 goes last of
 * the things you change and 操作记录 stays at the bottom, because the log is
 * the only one of the nine that is read rather than edited.
 */
export const SETTINGS_SECTIONS = [
  'alerts', 'catalog', 'policy', 'homeinventory',
  'homelines', 'providers', 'candidates', 'allowlist', 'audit',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function resolveSection(raw: string | null): SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(raw ?? '')
    ? raw as SettingsSection
    : 'alerts';
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/**
 * A delay or a cooldown, in the largest unit that divides it exactly.
 *
 * Exactly, not approximately: 90 seconds is the delay that stops a flap from
 * paging anyone, and rounding it to "2 分钟" would misreport the one number on
 * this page an operator tunes by hand. Zero is 不等 rather than "0 秒" — a
 * rule with no delay does not wait, and saying it in a unit invites the
 * reading that it waits a little.
 */
export function durationWord(seconds: number): string {
  const word = copy.settings.duration;
  if (!Number.isFinite(seconds) || seconds <= 0) return word.none;
  const whole = Math.round(seconds);
  if (whole % DAY === 0) return word.days(whole / DAY);
  if (whole % HOUR === 0) return word.hours(whole / HOUR);
  if (whole % MINUTE === 0) return word.minutes(whole / MINUTE);
  return word.seconds(whole);
}

/**
 * A delivery, as a neutral word plus what actually happened.
 *
 * `suppressed` is the one that has to be spelled out: it is not a failure and
 * not a send, it is the cooldown doing its job, and an operator who reads it
 * as "没发出去" goes looking for a broken webhook that is working fine.
 */
export function deliveryLine(status: DeliveryStatus): { word: string; why: string } {
  return { word: copy.deliveryStatus[status], why: copy.settings.alerts.deliveryWhy[status] };
}

/** Deliveries newest first, capped: this block is a sanity check, not a log. */
export function recentDeliveries(
  rows: readonly AlertDeliveryDto[],
  limit = 8,
): AlertDeliveryDto[] {
  return [...rows].sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * The billing cycle as one cell.
 *
 * The end date is the half an operator acts on — it is when the allowance
 * resets and when the bill lands — so a line that knows only one of the two
 * dates still renders that one rather than the em dash.
 */
export function cycleWord(start: number | null, end: number | null): string | null {
  if (start === null && end === null) return null;
  if (start === null) return formatDate(end);
  if (end === null) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export type UsageDay = { dayAt: number; bytes: number | null };

/**
 * Thirty calendar days of one line, oldest first, with gaps kept as gaps.
 *
 * The rows arrive one per day *per meter*, so they are summed before they are
 * placed; a day nobody metered stays `null` and draws nothing, because a zero
 * bar and an unmeasured day look identical once they are the same height, and
 * the difference is whether to go and check the meter.
 */
export function usageDays(
  rows: readonly HomeLineUsageDayDto[],
  days = 30,
  endDay = Math.floor(nowSec() / DAY) * DAY,
): UsageDay[] {
  const byDay = new Map<number, number>();
  for (const row of rows) {
    const key = Math.floor(row.dayAt / DAY) * DAY;
    byDay.set(key, (byDay.get(key) ?? 0) + row.bytesUp + row.bytesDown);
  }
  const out: UsageDay[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const dayAt = endDay - index * DAY;
    const bytes = byDay.get(dayAt);
    out.push({ dayAt, bytes: bytes === undefined ? null : bytes });
  }
  return out;
}

export const CANDIDATE_FILTERS = ['all', ...CANDIDATE_STATUSES] as const;
export type CandidateFilter = (typeof CANDIDATE_FILTERS)[number];

export function selectCandidates(
  rows: readonly DirectCandidateDto[],
  filter: CandidateFilter,
): DirectCandidateDto[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.status === filter);
}

export function candidateCounts(
  rows: readonly DirectCandidateDto[],
): Record<CandidateFilter, number> {
  const counts = { all: rows.length } as Record<CandidateFilter, number>;
  for (const status of CANDIDATE_STATUSES) counts[status] = 0;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** A word for who did it. An entry with no type is 没记名字, never a guess. */
export function actorWord(type: ActorType | null): string {
  return type === null ? copy.settings.audit.actorUnknown : copy.settings.audit.actorType[type];
}

export function candidateStatusWord(status: CandidateStatus): string {
  return copy.settings.candidates.status[status];
}

/**
 * An epoch as a `<input type="date">` value, and back.
 *
 * Both halves work in local time, because the dates on this page — a renewal,
 * the end of a billing cycle — are the ones printed on a bill in the
 * operator's own timezone, and a UTC round trip moves half of them a day.
 */
export function toDateInput(seconds: number | null): string {
  if (seconds === null) return '';
  const date = new Date(seconds * 1_000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateInput(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1_000);
}

/** A pretty-printed draft, or the words for one that came back with nothing. */
export function draftText(draft: unknown): string | null {
  if (draft === null || draft === undefined) return null;
  const text = JSON.stringify(draft, null, 2);
  return text === undefined ? null : text;
}
