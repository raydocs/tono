import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Measured, MetricSeries } from './measured';
import { Sparkline } from './Sparkline';
import { Value, type Tier } from './Value';

const TIER_CLASS: Record<Tier, string> = {
  row: 'text-[20px] font-medium leading-none',
  body: 'text-body',
  fine: 'text-fine',
};

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
  series,
  tier = 'row',
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: Measured<number | null>;
  format: (value: number) => { number: string; unit?: string };
  unit?: string;
  delta?: string | null;
  series?: MetricSeries | null;
  tier?: Tier;
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
      <div className="mt-0.5 truncate">
        {missing ? (
          <Value value={null} source={value.source} tier={tier} />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className={cn('font-mono', TIER_CLASS[tier])}>{shown?.number}</span>
            <span className="text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              {shown?.unit || unit || ''}
            </span>
          </span>
        )}
      </div>
      {missing ? null : <Sparkline series={series} className="mt-2" />}
    </div>
  );
}
