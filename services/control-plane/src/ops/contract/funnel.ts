// 开通漏斗：开通了还没用起来的人卡在哪一步，以及怎么找到他们。
//
// The list the console works down in the morning. It is deliberately not the
// customer list: half the people on it have no `users` row at all — an address
// that was allow-listed and never logged in has nothing else to its name — so
// they cannot carry a verdict, a health word or a 360 page. `key` is what a
// row is identified by on both halves: the user id when there is one, and
// `invite:<email>` when there is not.

import type { FunnelStage } from './vocabulary';
import { FUNNEL_STAGES } from './vocabulary';
import { arrayOf, fields, int, oneOf, optInt, optText, text } from './checkers';

/** One segment of the bar: the step, and how many people are standing on it. */
export interface FunnelStageCountDto {
  stage: FunnelStage;
  count: number;
}

/**
 * One person who has not connected yet.
 *
 * `userId` is null for somebody who was opened and never registered; the three
 * operator-owned fields travel with them either way, because the handle is the
 * only way to reach a person who has no account to look up.
 */
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

/** The bar and the people under it: `items` is everyone not yet connected. */
export interface FunnelDto {
  stages: FunnelStageCountDto[];
  items: FunnelRowDto[];
  updatedAt: number;
}

const STAGE_COUNT_KEYS = ['stage', 'count'];

export function assertFunnelStageCount(value: unknown, path = 'funnelStage'): FunnelStageCountDto {
  const row = fields(value, path, STAGE_COUNT_KEYS);
  return {
    stage: oneOf<FunnelStage>(row, path, 'stage', FUNNEL_STAGES),
    count: int(row, path, 'count'),
  };
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

const FUNNEL_KEYS = ['stages', 'items', 'updatedAt'];

export function assertFunnel(value: unknown, path = 'funnel'): FunnelDto {
  const row = fields(value, path, FUNNEL_KEYS);
  return {
    stages: arrayOf(row, path, 'stages', assertFunnelStageCount),
    items: arrayOf(row, path, 'items', assertFunnelRow),
    updatedAt: int(row, path, 'updatedAt'),
  };
}
