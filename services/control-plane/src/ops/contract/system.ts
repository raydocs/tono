// 状态页：数据源新鲜度、cron 每一步、回填还差多少。

import type { SourceId } from './vocabulary';
import { SOURCE_IDS } from './vocabulary';
import {
  arrayOf,
  bool,
  fields,
  int,
  oneOf,
  optInt,
  optText,
} from './checkers';

export const SOURCE_STATES = ['ready', 'stale', 'error', 'missing'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export interface SourceHealthDto {
  source: SourceId;
  state: SourceState;
  asOfSec: number | null;
  message: string | null;
}

/**
 * The header's 数据源 dot, collapsed to one word.
 *
 * The old console explained each data source on every page; this replaces all
 * of it. `ok` is false as soon as any source is not ready, because a green dot
 * over a dead collector is the failure mode the 死人开关 exists to catch.
 */
export const CRON_STEP_NAMES = [
  'flatten', 'project', 'verdicts', 'alerts', 'jobs', 'quota', 'daily', 'fx', 'retention',
] as const;
export type CronStepName = (typeof CRON_STEP_NAMES)[number];

export interface CronStepHealthDto {
  ok: boolean;
  ms: number;
  error: string | null;
}

export type CronStepsHealthDto = Record<CronStepName, CronStepHealthDto>;

/**
 * How far the projections have caught up with the telemetry that already
 * exists. Right after a deploy the customer pages read as silent for hours
 * while the cron drains 30 days of windows; this is what lets a page say
 * "正在回填" instead of looking broken. Null once nothing is behind.
 */
export interface BackfillHealthDto {
  windowsTotal: number;
  windowsFlattened: number;
  windowsProjected: number;
}

export interface SystemHealthDto {
  ok: boolean;
  buildSha: string | null;
  contractVersion: number;
  sources: SourceHealthDto[];
  cronLastRunAt: number | null;
  cronLastDurationMs: number | null;
  cronLastError: string | null;
  cronSteps: CronStepsHealthDto | null;
  backfill: BackfillHealthDto | null;
  updatedAt: number;
}

const SOURCE_HEALTH_KEYS = ['source', 'state', 'asOfSec', 'message'];

export function assertSourceHealth(value: unknown, path = 'sourceHealth'): SourceHealthDto {
  const row = fields(value, path, SOURCE_HEALTH_KEYS);
  return {
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
    state: oneOf<SourceState>(row, path, 'state', SOURCE_STATES),
    asOfSec: optInt(row, path, 'asOfSec'),
    message: optText(row, path, 'message'),
  };
}

const SYSTEM_HEALTH_KEYS = [
  'ok', 'buildSha', 'contractVersion', 'sources',
  'cronLastRunAt', 'cronLastDurationMs', 'cronLastError', 'cronSteps', 'backfill', 'updatedAt',
];

const CRON_STEP_HEALTH_KEYS = ['ok', 'ms', 'error'];

export function assertCronStepHealth(value: unknown, path = 'cronStep'): CronStepHealthDto {
  const row = fields(value, path, CRON_STEP_HEALTH_KEYS);
  return {
    ok: bool(row, path, 'ok'),
    ms: int(row, path, 'ms'),
    error: optText(row, path, 'error'),
  };
}

export function assertCronStepsHealth(value: unknown, path = 'cronSteps'): CronStepsHealthDto {
  const row = fields(value, path, CRON_STEP_NAMES);
  const steps = {} as CronStepsHealthDto;
  for (const name of CRON_STEP_NAMES) {
    steps[name] = assertCronStepHealth(row[name], `${path}.${name}`);
  }
  return steps;
}

export function assertSystemHealth(value: unknown, path = 'systemHealth'): SystemHealthDto {
  const row = fields(value, path, SYSTEM_HEALTH_KEYS);
  const cronSteps = row.cronSteps === undefined || row.cronSteps === null
    ? null
    : assertCronStepsHealth(row.cronSteps, `${path}.cronSteps`);
  return {
    ok: bool(row, path, 'ok'),
    buildSha: optText(row, path, 'buildSha'),
    contractVersion: int(row, path, 'contractVersion'),
    sources: arrayOf(row, path, 'sources', assertSourceHealth),
    cronLastRunAt: optInt(row, path, 'cronLastRunAt'),
    cronLastDurationMs: optInt(row, path, 'cronLastDurationMs'),
    cronLastError: optText(row, path, 'cronLastError'),
    cronSteps,
    backfill: row.backfill === undefined || row.backfill === null
      ? null
      : assertBackfillHealth(row.backfill, `${path}.backfill`),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const BACKFILL_KEYS = ['windowsTotal', 'windowsFlattened', 'windowsProjected'];

export function assertBackfillHealth(value: unknown, path = 'backfill'): BackfillHealthDto {
  const row = fields(value, path, BACKFILL_KEYS);
  return {
    windowsTotal: int(row, path, 'windowsTotal'),
    windowsFlattened: int(row, path, 'windowsFlattened'),
    windowsProjected: int(row, path, 'windowsProjected'),
  };
}
