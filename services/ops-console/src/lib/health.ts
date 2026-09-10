import type { CoverageDto, SystemHealthDto } from '@contract';
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

export interface CoverageLine {
  text: string;
  tone: 'unk' | null;
  unmeasured: boolean;
  baseText: string;
  toString(): string;
}

/**
 * How much of today's picture was actually measured.
 *
 * Appears above the verdict sentence on 今天: if any proportion is below 80%,
 * the whole line takes tone-unk and appends 有些没测到 so the operator knows
 * whether "no incidents" means the fleet is healthy or simply unmeasured.
 */
export function coverageLine(
  healthOrCoverage: SystemHealthDto | CoverageDto | null | undefined,
): CoverageLine | null {
  if (!healthOrCoverage) return null;
  const coverage: CoverageDto | undefined =
    'coverage' in healthOrCoverage
      ? healthOrCoverage.coverage
      : 'nodesListed' in healthOrCoverage
        ? (healthOrCoverage as CoverageDto)
        : undefined;
  if (!coverage) return null;

  const nodesListed = Number(coverage.nodesListed ?? 0);
  const nodesSweptFresh = Number(coverage.nodesSweptFresh ?? 0);
  const nodesWithAgent = Number(coverage.nodesWithAgent ?? 0);
  const customersActive = Number(coverage.customersActive ?? 0);
  const customersReportedFresh = Number(coverage.customersReportedFresh ?? 0);

  const sweepRatio = nodesListed > 0 ? nodesSweptFresh / nodesListed : 1;
  const agentRatio = nodesListed > 0 ? nodesWithAgent / nodesListed : 1;
  const customerRatio = customersActive > 0 ? customersReportedFresh / customersActive : 1;

  const unmeasured = sweepRatio < 0.8 || agentRatio < 0.8 || customerRatio < 0.8;
  const tone: 'unk' | null = unmeasured ? 'unk' : null;

  const baseText = copy.todayCoverage(
    nodesListed,
    nodesSweptFresh,
    nodesWithAgent,
    customersActive,
    customersReportedFresh,
  );

  const text = unmeasured ? `${baseText} · ${copy.todayCoverageUnmeasured}` : baseText;

  return {
    text,
    tone,
    unmeasured,
    baseText,
    toString() {
      return this.text;
    },
  };
}

