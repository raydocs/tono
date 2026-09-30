import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

export type Probe = 'alive' | 'dead' | null;

/**
 * One tick per probe, oldest on the left. A probe that never ran is hatched,
 * because "not probed" and "dead" lead to different actions and a blank or a
 * red tick would say the wrong one.
 *
 * The strip is one image to a screen reader, and its label is the count of
 * each kind rather than a list of forty ticks.
 */
export function ProbeStrip({
  probes,
  height = 16,
  className,
}: {
  probes: readonly Probe[];
  height?: number;
  className?: string;
}) {
  const alive = probes.filter((probe) => probe === 'alive').length;
  const dead = probes.filter((probe) => probe === 'dead').length;
  const gap = probes.length - alive - dead;
  return (
    <div
      role="img"
      aria-label={copy.probeSummary(probes.length, alive, dead, gap)}
      className={cn('flex items-end gap-px', className)}
      style={{ height }}
    >
      {probes.map((probe, index) => (
        <span
          key={index}
          title={copy.probeWord[probe ?? 'gap']}
          className={cn(
            'h-full w-[3px] shrink-0 rounded-[1px]',
            probe === 'alive' && 'tone-ok',
            probe === 'dead' && 'tone-sev',
            probe === null && 'probe-gap',
          )}
          style={probe === null ? undefined : { background: 'var(--tone-ink)' }}
        />
      ))}
    </div>
  );
}
