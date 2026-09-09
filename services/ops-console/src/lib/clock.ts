/**
 * The one place the console asks what time it is.
 *
 * Screenshot baselines are worthless if "刚刚 · 2026/9/9 03:23:46" changes on
 * every run, so `VITE_FAKE_NOW` freezes the clock for the fixture dev server
 * and the browser alike. It accepts epoch seconds, epoch milliseconds or
 * anything `Date.parse` understands, and is ignored when unset — production
 * never sees it.
 */

function rawFakeNow(): string | undefined {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const fromVite = meta.env?.VITE_FAKE_NOW;
  if (fromVite) return fromVite;
  if (typeof process !== 'undefined' && process.env?.VITE_FAKE_NOW) return process.env.VITE_FAKE_NOW;
  return undefined;
}

function parseFakeNow(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) {
    const digits = Number(trimmed);
    // Ten digits is an epoch in seconds, thirteen is milliseconds.
    return trimmed.length <= 10 ? digits * 1_000 : digits;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const FROZEN_MS = parseFakeNow(rawFakeNow());

export const clockIsFrozen = FROZEN_MS !== null;

export function nowMs(): number {
  return FROZEN_MS ?? Date.now();
}

export function nowSec(): number {
  return Math.floor(nowMs() / 1_000);
}
