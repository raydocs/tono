import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

/**
 * The four numbers behind the verdict sentence, each in its own caliber.
 *
 * Every cell is null-aware: a resource that has not landed renders a dash,
 * because a zero drawn from an empty array is a claim of calm nobody measured.
 * A real measured zero renders as zero.
 */
export function HeroKpis({
  open,
  impacted,
  due,
  swept,
  listed,
  sweptTone,
}: {
  open: number | null;
  impacted: number | null;
  due: number | null;
  swept: number | null;
  listed: number | null;
  /** Follows the coverage line: partly unmeasured stays grey, never green. */
  sweptTone: 'ok' | 'unk';
}) {
  const sweptText = swept === null || listed === null ? null : `${swept}/${listed}`;
  return (
    <div className="today-kpis" role="group" aria-label={copy.pages.today}>
      <Kpi
        label={copy.todayKpi.open}
        value={open === null ? null : String(open)}
        tone={open === null ? 'unk' : open > 0 ? 'sev' : 'ok'}
      />
      <Kpi
        label={copy.todayKpi.impacted}
        value={impacted === null ? null : String(impacted)}
        tone={impacted === null ? 'unk' : impacted > 0 ? 'warn' : 'ok'}
      />
      <Kpi
        label={copy.todayKpi.due}
        value={due === null ? null : String(due)}
        tone={due === null ? 'unk' : 'rem'}
      />
      <Kpi
        label={copy.todayKpi.swept}
        value={sweptText}
        tone={sweptText === null ? 'unk' : sweptTone}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone: 'sev' | 'warn' | 'rem' | 'ok' | 'unk';
}) {
  return (
    <div className="today-kpi">
      <span className="today-kpi-label text-micro text-[var(--muted-foreground)]">
        <span className={cn('today-kpi-dot', `tone-${tone}`)} aria-hidden />
        {label}
      </span>
      <div className="today-kpi-value">{value ?? copy.missing}</div>
    </div>
  );
}
