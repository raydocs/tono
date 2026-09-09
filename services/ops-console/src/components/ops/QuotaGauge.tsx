import { copy } from '@/copy/copy';
import { formatDate, formatPercent, splitBytes } from '@/lib/display';
import { cn } from '@/lib/utils';
import type { Measured } from './measured';

export function QuotaGauge({
  used,
  quota,
  cycleStartSec,
  className,
}: {
  used: Measured<number | null>;
  quota: number | null;
  cycleStartSec?: number | null;
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
        <span className="font-mono text-row">{copy.missing}</span>
        <span className="text-micro text-[var(--muted-foreground)]">{used.source}</span>
      </div>
    );
  }

  const remaining = quota - used.value;
  const remainRatio = quota === 0 ? null : remaining / quota;
  const usedRatio = quota === 0 ? 0 : Math.min(1, Math.max(0, used.value / quota));
  const eta = exhaustAt(used.value, quota, used.asOfSec, cycleStartSec);
  const usedSplit = splitBytes(used.value);
  const quotaSplit = splitBytes(quota);
  const over = remaining < 0;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-row">
          {usedSplit.number}
          <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
            {usedSplit.unit} / {quotaSplit.number} {quotaSplit.unit}
          </span>
        </span>
        <span className="font-mono text-micro text-[var(--muted-foreground)]">
          {copy.remaining} {formatPercent(remainRatio)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[999px] bg-[var(--hairline)]" aria-hidden>
        <div
          className={cn('h-full rounded-[999px]', over ? 'tone-sev' : usedRatio >= 0.9 ? 'tone-warn' : 'tone-ok')}
          style={{
            width: `${Math.min(100, Math.max(2, usedRatio * 100))}%`,
            background: 'hsl(var(--tone-line))',
          }}
        />
      </div>
      <div className="flex justify-between text-micro text-[var(--muted-foreground)]">
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
