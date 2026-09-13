import type { FunnelStage } from '@contract';
import { FUNNEL_STAGES } from '@contract';
import { CountText } from '@/components/ops/CountText';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

/**
 * The onboarding funnel, as one line above the table.
 *
 * The five steps read left to right in the order they happen, and the counts
 * come from the same selector the table filters with — press a segment and the
 * rows you get are the people it just counted (R4). It is the customer page's
 * second sentence rather than a chart because that is what it is: five numbers
 * and a verb each, and a funnel drawn as trapezoids would spend a third of the
 * page saying the same five numbers less exactly.
 *
 * Only the last segment carries a tone, and it is the healthy one. The four
 * before it are prose: nothing is broken about a customer who has not started
 * yet, and colouring them would put four alarms on a page where nothing has
 * failed.
 */
export function FunnelBar({
  counts,
  stage,
  onPick,
}: {
  counts: Record<FunnelStage, number>;
  stage: FunnelStage | null;
  onPick: (stage: FunnelStage | null) => void;
}) {
  return (
    <p className="text-body">
      {FUNNEL_STAGES.map((id, index) => (
        <span key={id}>
          {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
          <button
            type="button"
            aria-pressed={stage === id}
            className={cn('count-bit', id === 'connected' ? 'tone-ok' : 'tone-none')}
            onClick={() => onPick(stage === id ? null : id)}
          >
            <CountText values={[counts[id]]} render={(values) => copy.funnelCount[id](values[0])} />
          </button>
        </span>
      ))}
    </p>
  );
}
