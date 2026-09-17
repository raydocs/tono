import {
  arrayOf,
  fields,
  int,
  optInt,
  optNum,
  optText,
  text,
} from './checkers';
import type { CarrierKey, Platform } from './vocabulary';

export interface SloRowDto {
  dayAt: number;
  platform: Platform | string;
  carrier: CarrierKey | string;
  node: string;
  attempts: number;
  successes: number;
  p50Ms: number | null;
  verifiedOutageMin: number;
  unmeasuredMin: number;
  rulesVersion?: number;
}

export interface SloSummaryDto {
  successRate: number | null;
  p50Ms: number | null;
  verifiedOutageMin: number;
  unmeasuredMin: number;
  coverage: number;
}

export interface SloResponseDto {
  items: SloRowDto[];
  summary: SloSummaryDto;
  nextCursor?: string | null;
  total?: number;
  updatedAt: number;
}

const SLO_ROW_KEYS = [
  'dayAt',
  'platform',
  'carrier',
  'node',
  'attempts',
  'successes',
  'p50Ms',
  'verifiedOutageMin',
  'unmeasuredMin',
  'rulesVersion',
] as const;

export function assertSloRow(value: unknown, path = 'sloRow'): SloRowDto {
  const row = fields(value, path, SLO_ROW_KEYS);
  const out: SloRowDto = {
    dayAt: int(row, path, 'dayAt'),
    platform: text(row, path, 'platform'),
    carrier: text(row, path, 'carrier'),
    node: text(row, path, 'node'),
    attempts: int(row, path, 'attempts'),
    successes: int(row, path, 'successes'),
    p50Ms: optInt(row, path, 'p50Ms'),
    verifiedOutageMin: int(row, path, 'verifiedOutageMin'),
    unmeasuredMin: int(row, path, 'unmeasuredMin'),
  };
  if ('rulesVersion' in row && row.rulesVersion !== undefined) {
    out.rulesVersion = int(row, path, 'rulesVersion');
  }
  return out;
}

const SLO_SUMMARY_KEYS = [
  'successRate',
  'p50Ms',
  'verifiedOutageMin',
  'unmeasuredMin',
  'coverage',
] as const;

export function assertSloSummary(value: unknown, path = 'sloSummary'): SloSummaryDto {
  const row = fields(value, path, SLO_SUMMARY_KEYS);
  return {
    successRate: optNum(row, path, 'successRate'),
    p50Ms: optInt(row, path, 'p50Ms'),
    verifiedOutageMin: int(row, path, 'verifiedOutageMin'),
    unmeasuredMin: int(row, path, 'unmeasuredMin'),
    coverage: optNum(row, path, 'coverage') ?? 0,
  };
}

const SLO_RESPONSE_KEYS = [
  'items',
  'summary',
  'nextCursor',
  'total',
  'updatedAt',
] as const;

export function assertSloResponse(value: unknown, path = 'slo'): SloResponseDto {
  const row = fields(value, path, SLO_RESPONSE_KEYS);
  const resp: SloResponseDto = {
    items: arrayOf(row, path, 'items', assertSloRow),
    summary: assertSloSummary(row.summary, `${path}.summary`),
    nextCursor: optText(row, path, 'nextCursor'),
    updatedAt: int(row, path, 'updatedAt'),
  };
  if ('total' in row && row.total !== undefined) {
    resp.total = int(row, path, 'total');
  }
  return resp;
}
