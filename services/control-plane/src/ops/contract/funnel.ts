// Onboarding funnel: who was opened but never got to use it.

import type { FunnelStage } from './vocabulary';
import { FUNNEL_STAGES } from './vocabulary';
import {
  arrayOf,
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
} from './checkers';

export interface FunnelRowDto {
  key: string;
  userId: string | null;
  email: string;
  wechatId: string | null;
  contact: string | null;
  notes: string | null;
  stage: FunnelStage;
  stageSinceAt: number;
  lastSeenAt: number | null;
}

export interface FunnelStageCountDto {
  stage: FunnelStage;
  count: number;
}

export interface FunnelDto {
  stages: FunnelStageCountDto[];
  items: FunnelRowDto[];
  updatedAt: number;
}

const FUNNEL_ROW_KEYS = [
  'key', 'userId', 'email', 'wechatId', 'contact', 'notes', 'stage', 'stageSinceAt', 'lastSeenAt',
];

export function assertFunnelRow(value: unknown, path = 'funnelRow'): FunnelRowDto {
  const row = fields(value, path, FUNNEL_ROW_KEYS);
  return {
    key: text(row, path, 'key'),
    userId: optText(row, path, 'userId'),
    email: text(row, path, 'email'),
    wechatId: optText(row, path, 'wechatId'),
    contact: optText(row, path, 'contact'),
    notes: optText(row, path, 'notes'),
    stage: oneOf<FunnelStage>(row, path, 'stage', FUNNEL_STAGES),
    stageSinceAt: int(row, path, 'stageSinceAt'),
    lastSeenAt: optInt(row, path, 'lastSeenAt'),
  };
}

const STAGE_COUNT_KEYS = ['stage', 'count'];

export function assertFunnelStageCount(value: unknown, path = 'funnelStage'): FunnelStageCountDto {
  const row = fields(value, path, STAGE_COUNT_KEYS);
  return {
    stage: oneOf<FunnelStage>(row, path, 'stage', FUNNEL_STAGES),
    count: int(row, path, 'count'),
  };
}

const FUNNEL_KEYS = ['stages', 'items', 'updatedAt'];

export function assertFunnel(value: unknown, path = 'funnel'): FunnelDto {
  const row = fields(value, path, FUNNEL_KEYS);
  return {
    stages: arrayOf(row, path, 'stages', assertFunnelStageCount),
    items: arrayOf(row, path, 'items', assertFunnelRow),
    updatedAt: int(row, path, 'updatedAt'),
  };
}
