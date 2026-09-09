import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Measured } from './measured';
import type { Tone } from './StatusWord';
import { Value } from './Value';

/** One measured number with its label, sized to sit inside a node card cell. */
export function MetricCard({
  icon,
  label,
  value,
  format,
  unit,
  delta,
  tone = 'unk',
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: Measured<number | null>;
  format: (value: number) => { number: string; unit?: string };
  unit?: string;
  delta?: string | null;
  tone?: Tone;
  className?: string;
}) {
  const raw = value.value;
  const missing = raw === null || raw === undefined;
  const shown = missing ? null : format(raw);
  const colorTone = missing ? 'unk' : tone;

  return (
    <div className={cn('flex min-w-0 flex-col', `tone-${colorTone}`, className)}>
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-[6px] bg-[hsl(var(--tone-bg))] text-[hsl(var(--tone-fg))]">
            {icon}
          </span>
        ) : null}
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
            <span className="font-mono text-[20px] font-medium leading-none text-[hsl(var(--tone-fg))]">
              {shown?.number}
            </span>
            <span className="text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              {shown?.unit || unit || ''}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
