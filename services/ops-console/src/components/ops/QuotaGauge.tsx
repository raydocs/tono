import { copy } from '@/copy/copy';
import { formatDate, formatPercent, splitBytes } from '@/lib/display';
import { cn } from '@/lib/utils';
import type { Measured, MetricSeries } from './measured';
import { Sparkline } from './Sparkline';
import type { Tone } from './StatusWord';
import { Value } from './Value';

/**
 * The three quota thresholds from the plan (70 / 90 / 100 %) are the only
 * thing that decides this component's colour, so the bar, the sparkline and
 * any inline bar elsewhere all shade the same way for the same node.
 */
export function quotaTone(used: number | null, quota: number | null): Tone {
  if (used == null || quota == null || quota <= 0) return 'unk';
  const ratio = used / quota;
  if (ratio >= 1) return 'sev';
  if (ratio >= 0.9) return 'warn';
  if (ratio >= 0.7) return 'rem';
  return 'ok';
}

export function usedRatio(used: number | null, quota: number | null): number {
  if (used == null || quota == null || quota <= 0) return 0;
  return Math.min(1, Math.max(0, used / quota));
}

/** The 2 px bar on its own, for table rows that have no room for the gauge. */
export function QuotaBar({
  used,
  quota,
  className,
}: {
  used: number | null;
  quota: number | null;
  className?: string;
}) {
  const ratio = usedRatio(used, quota);
  return (
    <div
      className={cn('h-[2px] w-full overflow-hidden rounded-[999px] bg-[var(--hairline)]', className)}
      aria-hidden
    >
      <div
        className={cn('h-full rounded-[999px]', `tone-${quotaTone(used, quota)}`)}
        style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%`, background: 'hsl(var(--tone-line))' }}
      />
    </div>
  );
}

export function QuotaGauge({
  used,
  quota,
  cycleStartSec,
  series,
  className,
}: {
  used: Measured<number | null>;
  quota: number | null;
  cycleStartSec?: number | null;
  series?: MetricSeries | null;
  className?: string;
}) {
  if (quota == null) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <span className="text-micro text-[var(--muted-foreground)]">{copy.noQuota}</span>
      </div>
    );
  }
  if (used.value == null) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <Value value={null} source={used.source} />
      </div>
    );
  }

  const remaining = quota - used.value;
  const remainRatio = quota === 0 ? null : remaining / quota;
  const ratio = usedRatio(used.value, quota);
  const eta = exhaustAt(used.value, quota, used.asOfSec, cycleStartSec);
  const usedSplit = splitBytes(used.value);
  const quotaSplit = splitBytes(quota);
  const tone = quotaTone(used.value, quota);

  return (
    <div className={cn('flex flex-col gap-1', `tone-${tone}`, className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-row">
          {usedSplit.number}
          <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
            {usedSplit.unit} / {quotaSplit.number} {quotaSplit.unit}
          </span>
        </span>
        <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
          {copy.remaining} {formatPercent(remainRatio)}
        </span>
      </div>
      <div className="h-[2px] overflow-hidden rounded-[999px] bg-[var(--hairline)]" aria-hidden>
        <div
          className="h-full rounded-[999px]"
          style={{
            width: `${Math.min(100, Math.max(2, ratio * 100))}%`,
            background: 'hsl(var(--tone-line))',
          }}
        />
      </div>
      <Sparkline series={series} />
      <div className="flex justify-between gap-2 text-micro text-[var(--muted-foreground)]">
        <span>{copy.exhaustEta}</span>
        <span className="font-mono">{eta == null ? copy.missing : formatDate(eta)}</span>
      </div>
    </div>
  );
}

function exhaustAt(
  used: number,
  quota: number,
  asOfSec: number | null,
  cycleStartSec: number | null | undefined,
): number | null {
  if (used <= 0 || quota <= 0 || asOfSec == null || cycleStartSec == null) return null;
  if (asOfSec <= cycleStartSec) return null;
  const rate = used / (asOfSec - cycleStartSec);
  if (rate <= 0) return null;
  const remaining = quota - used;
  if (remaining <= 0) return asOfSec;
  return Math.round(asOfSec + remaining / rate);
}
