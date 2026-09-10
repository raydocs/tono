import { copy } from '@/copy/copy';

/**
 * The five node health words, in the engine's precedence order.
 *
 * This file used to derive the word itself, from the probe status and the agent
 * heartbeat the old fleet read carried. It no longer does, and that is the
 * point: the verdict is computed once, server-side, with hysteresis, and both
 * 今天 and 节点 read the same field (R4). Deriving it a second time in the
 * browser is exactly what let 节点 report 被墙 on a machine 今天 had already
 * stopped counting.
 */
export const HEALTH_WORDS = [
  copy.health.lost,
  copy.health.blocked,
  copy.health.degraded,
  copy.health.ok,
  copy.health.unmeasured,
] as const;

export type HealthWord = (typeof HEALTH_WORDS)[number];
