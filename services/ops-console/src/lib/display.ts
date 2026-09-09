import { formatBytes, timestamp } from '@legacy-lib/format';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return copy.missing;
  return String(Math.round(value));
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return copy.missing;
  return `${Math.round(ms)} ${copy.unit.ms}`;
}

export function formatLoss(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return copy.missing;
  const tenths = Math.round(pct * 10);
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return frac === 0 ? `${whole}${copy.unit.pct}` : `${whole}.${frac}${copy.unit.pct}`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return copy.missing;
  return `${Math.round(ratio * 100)}${copy.unit.pct}`;
}

export function formatBytesMeasured(value: number | null | undefined): string {
  return formatBytes(value);
}

export function formatWhen(value: number | null | undefined): string {
  return timestamp(value);
}

/**
 * Relative time reads off `nowSec()` rather than `Date.now()` so a frozen
 * clock freezes the words too; the legacy `timeAgo` could not be reused for
 * exactly that reason.
 */
export function formatWhenAgo(value: number | null | undefined): string {
  if (value === null || value === undefined) return copy.missing;
  const seconds = Math.max(0, nowSec() - value);
  if (seconds < 90) return copy.ago.now;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return copy.ago.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy.ago.hours(hours);
  return copy.ago.days(Math.floor(hours / 24));
}

export function formatClock(value: number | null | undefined): string {
  if (value === null || value === undefined) return copy.missing;
  const date = new Date(value * 1_000);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hh = hours < 10 ? `0${hours}` : String(hours);
  const mm = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${hh}:${mm}`;
}

export function formatDate(value: number | null | undefined): string {
  if (value === null || value === undefined) return copy.missing;
  const date = new Date(value * 1_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function splitBytes(value: number | null | undefined): { number: string; unit: string } {
  const text = formatBytes(value);
  if (text === copy.missing) return { number: copy.missing, unit: '' };
  const cut = text.lastIndexOf(' ');
  if (cut < 0) return { number: text, unit: '' };
  return { number: text.slice(0, cut), unit: text.slice(cut + 1) };
}
