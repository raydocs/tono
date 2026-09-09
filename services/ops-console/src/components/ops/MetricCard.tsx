import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Measured } from './measured';
import { Value } from './Value';

/**
 * One measured number with its label. The icon tile is deliberately grey:
 * colour on this page belongs to the status word, the quota bar and the
 * primary action, and a tinted tile behind a plain fact only competes with
 * them.
 */
export function MetricCard({
  icon,
  label,
  value,
  format,
  unit,
  delta,
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: Measured<number | null>;
  format: (value: number) => { number: string; unit?: string };
  unit?: string;
  delta?: string | null;
  className?: string;
}) {
  const raw = value.value;
  const missing = raw === null || raw === undefined;
  const shown = missing ? null : format(raw);

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="flex items-center gap-2">
        {icon ? <span className="metric-tile">{icon}</span> : null}
        <span className="min-w-0 truncate text-micro text-[var(--muted-foreground)]">{label}</span>
        {delta ? (
          <span className="ml-auto shrink-0 rounded-[999px] border border-[var(--hairline)] px-2 py-0.5 font-mono text-micro text-[var(--muted-foreground)]">
            {delta}
          </span>
        ) : null}
      </div>
      <div className="mt-1 truncate">
        {missing ? (
          <Value value={null} source={value.source} />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[20px] font-medium leading-none">{shown?.number}</span>
            <span className="text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              {shown?.unit || unit || ''}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
