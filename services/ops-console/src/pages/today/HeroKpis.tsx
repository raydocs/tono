import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { formatCount } from '@/lib/display';

/** Four null-aware readings behind the verdict; trends belong below handling. */
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
  const sweptText = swept === null || listed === null ? null : copy.todaySweptOf(formatCount(swept), formatCount(listed));
  return (
    <div className="today-kpis" role="group" aria-label={copy.todayKpiGroup}>
      <StatTile
        label={copy.todayKpi.open}
        value={open === null ? null : formatCount(open)}
        tone={open === null ? 'unk' : open > 0 ? 'sev' : 'ok'}
      />
      <StatTile
        label={copy.todayKpi.impacted}
        value={impacted === null ? null : formatCount(impacted)}
        tone={impacted === null ? 'unk' : impacted > 0 ? 'warn' : 'ok'}
      />
      <StatTile
        label={copy.todayKpi.due}
        value={due === null ? null : formatCount(due)}
        tone={due === null ? 'unk' : due > 0 ? 'rem' : 'ok'}
      />
      <StatTile
        label={copy.todayKpi.swept}
        value={sweptText}
        tone={sweptText === null ? 'unk' : sweptTone}
      />
    </div>
  );
}
