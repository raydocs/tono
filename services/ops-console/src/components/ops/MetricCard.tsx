import type { ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import type { Measured } from './measured';
import type { Tone } from './StatusWord';

export function MetricCard({
  icon,
  label,
  value,
  format,
  unit,
  delta,
  spark,
  tone = 'unk',
  className,
}: {
  icon?: ReactNode;
  label: string;
  value: Measured<number | null>;
  format: (value: number) => { number: string; unit?: string };
  unit?: string;
  delta?: string | null;
  spark?: Array<number | null>;
  tone?: Tone;
  className?: string;
}) {
  const raw = value.value;
  const missing = raw === null || raw === undefined;
  const shown = missing ? null : format(raw);
  const points = (spark ?? []).map((n, i) => ({ i, v: n }));
  const hasSpark = points.some((p) => p.v != null);
  const colorTone = missing ? 'unk' : tone;

  return (
    <div
      className={cn(
        'relative flex min-h-[92px] flex-col gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] p-4',
        `tone-${colorTone}`,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[hsl(var(--tone-bg))] text-[hsl(var(--tone-fg))]">
          {icon}
        </div>
        {delta ? (
          <span className="rounded-[999px] border border-[var(--hairline)] px-2 py-0.5 font-mono text-micro text-[var(--muted-foreground)]">
            {delta}
          </span>
        ) : null}
      </div>
      <div className="text-micro text-[var(--muted-foreground)]">{label}</div>
      {missing ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-row">{copy.missing}</span>
          <span className="text-micro text-[var(--muted-foreground)]">{value.source}</span>
        </div>
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[20px] font-medium leading-none text-[hsl(var(--tone-fg))]">
            {shown?.number}
          </span>
          <span className="text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
            {shown?.unit || unit || ''}
          </span>
        </div>
      )}
      {hasSpark && !missing ? (
        <div className="mt-auto h-8 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--tone-line))"
                fill="hsl(var(--tone-bg))"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
