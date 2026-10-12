import { StatTile } from '@/components/ops/StatTile';
import { copy } from '@/copy/copy';
import { formatCount } from '@/lib/display';
import type { CoverageLine } from '@/lib/health';

/** Four null-aware readings behind the verdict; trends belong below handling. */
export function HeroKpis({
  open,
  impacted,
  due,
  swept,
  listed,
  sweptTone,
  coverage,
  agents,
  reported,
  active,
}: {
  open: number | null;
  impacted: number | null;
  due: number | null;
  swept: number | null;
  listed: number | null;
  /** Follows the coverage line: partly unmeasured stays grey, never green. */
  sweptTone: 'ok' | 'unk';
  /** The full coverage sentence: it rides the tile's hover title. */
  coverage: CoverageLine | null;
  /** Probes online, customers reported fresh and customers active: the same three numbers the sentence spells. */
  agents: number | null;
  reported: number | null;
  active: number | null;
}) {
  const sweptText = swept === null || listed === null ? null : copy.todaySweptOf(formatCount(swept), formatCount(listed));
  /**
   * The coverage sentence used to sit above the verdict and wrap to three lines
   * on a phone. The tile it qualifies carries the short form now, and the long
   * one stays a hover away; a partly unmeasured picture says so instead of the
   * numbers, as the sentence did.
   */
  const sweptSub = coverage === null || agents === null || reported === null || active === null
    ? undefined
    : coverage.tone === 'unk'
      ? copy.todayCoverageUnmeasured
      : copy.todayCoverageShort(agents, reported, active);
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
        sub={sweptSub}
        title={coverage?.text}
      />
    </div>
  );
}
