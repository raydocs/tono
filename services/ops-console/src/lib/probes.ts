import type { Probe } from '@/components/ops/ProbeStrip';

/**
 * The hub's recent pings for one carrier, as ticks.
 *
 * A round with neither a latency nor a loss figure never ran and stays a gap;
 * a round that lost everything, or came back with no latency, is dead. Loss
 * short of total is still alive — the loss column says how badly.
 */
export function probesOf(history: ReadonlyArray<{ latencyMs: number | null; lossPct: number | null }>): Probe[] {
  return history.map((round) => {
    if (round.latencyMs === null && round.lossPct === null) return null;
    if (round.latencyMs === null || (round.lossPct !== null && round.lossPct >= 100)) return 'dead';
    return 'alive';
  });
}
