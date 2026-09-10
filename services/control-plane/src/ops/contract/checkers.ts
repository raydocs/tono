// The runtime half of the contract: cheap shape checks, no schema library.
//
// Why these exist at all. The console and the Worker are two codebases that
// agree only by convention; a handler that quietly stops sending `asOfSec`
// produces a page full of confident numbers with no freshness, which is the
// exact failure this whole rebuild is meant to end. So every ops response is
// run through a checker before it leaves the Worker (and again over the
// committed fixtures in the console's own suite). Drift becomes a 500 with the
// offending field name — loud, in staging, on the first request.
//
// They are deliberately not zod: this runs inside a Worker CPU budget, a
// response can carry a few thousand rows, and a key allow-list plus a typeof
// test is two orders of magnitude cheaper than a parser. The style follows
// `rejectUnexpectedKeys` in src/request.ts — an allow-list, not a schema.
//
// Purity rule: nothing in this folder may import anything but the shared
// `errors` module and its own siblings. No Env, no D1 types.
// `tooling/scripts/check-ops-contract-purity.mjs` enforces it, because the
// console consumes these types directly through the `@contract` path, and one
// stray `import type { Env }` would drag the whole Worker into a browser build.

import { ApiError } from '../../errors';
import type { Measured, SourceId } from './vocabulary';
import { SOURCE_IDS } from './vocabulary';

/** Every drift looks the same from outside: 500, and which field lied. */
export function violation(field: string): never {
  throw new ApiError(500, 'CONTRACT_VIOLATION', field);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Assert `value` is an object whose keys are all on the allow-list, and hand
 * back the row for field reads. Missing keys are caught by the field readers
 * below — an absent key reads as `undefined` and fails its type test — so the
 * two halves together reject both drift directions.
 */
export function fields(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) violation(path);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) violation(`${path}.${key}`);
  }
  return value;
}

export function text(row: Record<string, unknown>, path: string, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') violation(`${path}.${key}`);
  return value;
}

export function optText(row: Record<string, unknown>, path: string, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') violation(`${path}.${key}`);
  return value;
}

export function int(row: Record<string, unknown>, path: string, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) violation(`${path}.${key}`);
  return value as number;
}

export function optInt(row: Record<string, unknown>, path: string, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) violation(`${path}.${key}`);
  return value as number;
}

/** Non-integer measurements: rates, percentages, loss. NaN is drift, not data. */
export function num(row: Record<string, unknown>, path: string, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) violation(`${path}.${key}`);
  return value as number;
}

export function optNum(row: Record<string, unknown>, path: string, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) violation(`${path}.${key}`);
  return value as number;
}

export function bool(row: Record<string, unknown>, path: string, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') violation(`${path}.${key}`);
  return value;
}

export function optBool(row: Record<string, unknown>, path: string, key: string): boolean | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'boolean') violation(`${path}.${key}`);
  return value;
}

export function oneOf<T extends string>(
  row: Record<string, unknown>,
  path: string,
  key: string,
  allowed: readonly T[],
): T {
  const value = row[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) violation(`${path}.${key}`);
  return value as T;
}

export function optOneOf<T extends string>(
  row: Record<string, unknown>,
  path: string,
  key: string,
  allowed: readonly T[],
): T | null {
  if (row[key] === null) return null;
  return oneOf(row, path, key, allowed);
}

export function arrayOf<T>(
  row: Record<string, unknown>,
  path: string,
  key: string,
  item: (value: unknown, path: string) => T,
): T[] {
  const value = row[key];
  if (!Array.isArray(value)) violation(`${path}.${key}`);
  return (value as unknown[]).map((entry, index) => item(entry, `${path}.${key}[${index}]`));
}

/** A list drawn from a closed vocabulary — platforms, service families. */
export function enumList<T extends string>(
  row: Record<string, unknown>,
  path: string,
  key: string,
  allowed: readonly T[],
): T[] {
  return arrayOf(row, path, key, (value, at) => {
    if (typeof value !== 'string' || !allowed.includes(value as T)) violation(at);
    return value as T;
  });
}

/** A list of plain strings — line tags, targets, top processes. */
export function textList(row: Record<string, unknown>, path: string, key: string): string[] {
  return arrayOf(row, path, key, (value, at) => {
    if (typeof value !== 'string') violation(at);
    return value;
  });
}

/**
 * A measured value. The freshness stamp is checked, not just its presence:
 * `asOfSec` is either null (never measured) or a positive epoch second. A zero
 * would render as 1970 and read as "measured, ages ago", which is the one
 * reading it must never have.
 */
export function measured<T>(
  row: Record<string, unknown>,
  path: string,
  key: string,
  inner: (value: unknown, path: string) => T,
): Measured<T> {
  const at = `${path}.${key}`;
  const cell = fields(row[key], at, ['value', 'asOfSec', 'source']);
  const asOfSec = optInt(cell, at, 'asOfSec');
  if (asOfSec !== null && asOfSec <= 0) violation(`${at}.asOfSec`);
  return {
    value: inner(cell.value, `${at}.value`),
    asOfSec,
    source: oneOf<SourceId>(cell, at, 'source', SOURCE_IDS),
  };
}

/** Inner checkers for the common `Measured<scalar>` cases. */
export const measuredInt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) violation(path);
  return value as number;
};

export const measuredOptInt = (value: unknown, path: string): number | null =>
  value === null ? null : measuredInt(value, path);

export const measuredOptNum = (value: unknown, path: string): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) violation(path);
  return value as number;
};

export const measuredBool = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') violation(path);
  return value;
};

/** `Measured<T[]>`: an inner checker for a list that carries one freshness stamp. */
export function measuredArray<T>(item: (value: unknown, path: string) => T) {
  return (value: unknown, path: string): T[] => {
    if (!Array.isArray(value)) violation(path);
    return (value as unknown[]).map((entry, index) => item(entry, `${path}[${index}]`));
  };
}

/** The list envelope every collection endpoint returns. */
export interface ListDto<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
  updatedAt: number;
}

/**
 * Check a list response and its rows in one pass.
 *
 * `total` is optional because a few endpoints cannot count cheaply, but when
 * present it must be a real count — an absent key and a `null` mean different
 * things to the console ("we don't count this" vs. drift), so `null` is
 * rejected.
 */
export function assertList<T>(
  value: unknown,
  itemChecker: (value: unknown, path?: string) => T,
  path = 'list',
): ListDto<T> {
  const row = fields(value, path, ['items', 'nextCursor', 'total', 'updatedAt']);
  const items = arrayOf(row, path, 'items', (entry, at) => itemChecker(entry, at));
  const envelope: ListDto<T> = {
    items,
    nextCursor: optText(row, path, 'nextCursor'),
    updatedAt: int(row, path, 'updatedAt'),
  };
  if ('total' in row) envelope.total = int(row, path, 'total');
  return envelope;
}
