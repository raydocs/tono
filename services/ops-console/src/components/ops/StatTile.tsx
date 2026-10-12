import type { ReactNode } from 'react';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { Spark } from './Spark';
import type { Tone } from './StatusWord';
import type { SeriesPoint } from './TimeSeries';

/**
 * One headline number on a dashboard band: label, value, one line of context
 * and, when there is history behind it, the shape of that history.
 *
 * The value arrives already spelled by `lib/display`; `null` is a dash, never
 * a zero. The dot takes a tone only when the caller has a rule for one — a
 * number with no threshold behind it stays grey rather than borrowing green —
 * and the number itself is coloured only for the tones that ask for action.
 */
/**
 * Mono is for the digits. A unit spelled in CJK ("days left") has no glyph in
 * Geist Mono, falls back to the system face at the number's size and sits
 * after a full-width mono space, so it read as a second number. Runs of CJK
 * (and the space before them) become a sans unit at a smaller size.
 */
const CJK_RUN = /(\s*[\u3000-\u9fff\uff00-\uffef]+)/;

function Spelled({ value }: { value: string }) {
  const parts = value.split(CJK_RUN).filter((part) => part !== '');
  if (parts.length === 1 && !CJK_RUN.test(value)) return value;
  return parts.map((part, index) => (CJK_RUN.test(part)
    ? <span key={index} className="stat-unit">{part.trim()}</span>
    : part));
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  trend,
  trendDomain,
  className,
}: {
  label: string;
  value: string | null;
  sub?: ReactNode;
  tone?: Tone;
  trend?: readonly SeriesPoint[];
  trendDomain?: [number, number];
  className?: string;
}) {
  const loud = tone === 'sev' || tone === 'warn' || tone === 'rem';
  return (
    <div className={cn('stat-tile raised flex min-w-0 flex-col gap-1 rounded-[10px] bg-[var(--surface)] px-4 py-3.5', className)}>
      <span className="flex items-center gap-1.5 text-micro text-[var(--muted-foreground)]">
        {tone ? <span aria-hidden className={cn('stat-dot', `tone-${tone}`)} /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('stat-value font-mono', loud && `tone-${tone} tone-fg`)}>
        {value === null ? copy.missing : <Spelled value={value} />}
      </span>
      {sub ? <span className="truncate text-fine">{sub}</span> : null}
      {trend && trendDomain ? <Spark points={trend} domain={trendDomain} className="mt-1" /> : null}
    </div>
  );
}
