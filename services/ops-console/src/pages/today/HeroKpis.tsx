import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { formatCount } from '@/lib/display';
import { useIsPhone } from '@/lib/use-phone';
import { QualityBand } from './Quality';

/**
 * The four numbers behind the verdict sentence, each in its own caliber, and
 * the connection-quality band under them.
 *
 * Every cell is null-aware: a resource that has not landed renders a dash,
 * because a zero drawn from an empty array is a claim of calm nobody measured.
 * A real measured zero renders as zero.
 *
 * The band is mounted from here rather than from the page so the page file
 * keeps its one job — deciding what the verdict says — and the dashboard
 * below it can grow without touching that decision.
 *
 * Not on a phone: mounted here the band sits above the incident list, and on
 * a phone the first screen belongs to the incident and its claim button. It
 * comes back on the phone once the page itself can place it below the list.
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
  const phone = useIsPhone();
  const sweptText = swept === null || listed === null ? null : copy.todaySweptOf(formatCount(swept), formatCount(listed));
  return (
    <>
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
      {phone ? null : <QualityBand />}
    </>
  );
}
