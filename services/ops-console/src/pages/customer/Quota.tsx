import type { CustomerDetailDto } from '@contract';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatPercent, splitBytes } from '@/lib/display';
import { shown } from '@/lib/sources';

/**
 * Used, capped, and how much is left — without the node page's exhaustion
 * forecast. That forecast needs a cycle start, a customer record has none, and
 * feeding it the first-entitlement date produced a confident exhaustion date
 * two years out: a projection with nothing behind it is worse than none.
 */
export function Quota({ billing }: { billing: CustomerDetailDto['billing'] }) {
  const usage = shown(billing.usageBytes);
  const quota = billing.quotaBytes;
  const used = usage.value === null ? null : splitBytes(usage.value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{copy.quota}</span>
      {used === null || quota === null || quota <= 0 ? (
        <Value value={used === null ? null : `${used.number} ${used.unit}`} source={usage.source} mono />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-row">
              {used.number}
              <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                {used.unit} / {splitBytes(quota).number} {splitBytes(quota).unit}
              </span>
            </span>
            <span className="font-mono text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {copy.remaining}{' '}
              {quota - (usage.value ?? 0) < 0
                ? copy.overQuota
                : formatPercent((quota - (usage.value ?? 0)) / quota)}
            </span>
          </div>
          <QuotaBar used={usage.value} quota={quota} alarmOnly />
        </>
      )}
    </div>
  );
}
