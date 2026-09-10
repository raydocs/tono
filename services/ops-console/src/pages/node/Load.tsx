import { useMemo, useState } from 'react';
import { Chip } from '@/components/ops/Chip';
import { Fact } from '@/components/ops/DetailDrawer';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { TimeSeries, type SeriesPoint } from '@/components/ops/TimeSeries';
import { absent, measured, type Measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatClock, formatCount, formatDate, formatPercent, formatWhenAgo } from '@/lib/display';
import {
  foldLoad,
  hasLoad,
  nodeLegacyApi,
  NODE_LOAD_RANGES,
  type LoadCharts,
  type NodeLoadRange,
} from '@/lib/node-legacy';
import { sourceWord } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';

const DAY: NodeLoadRange = '24h';

/**
 * The machine's own load, folded shut.
 *
 * Folded because it is the block an operator opens when they already suspect
 * the machine rather than the path — the page's first four blocks answer
 * "should I care about this node at all", and four charts under them would
 * make every visit scroll past a shape nobody asked for. Folded also means
 * the request is not made: the body below is only mounted once the fold is
 * open, so a page load costs the same as it did before this section existed.
 */
export function NodeLoad({ name }: { name: string }) {
  return (
    <FoldedSection title={copy.nodeSections.load}>
      <LoadBody name={name} />
    </FoldedSection>
  );
}

function LoadBody({ name }: { name: string }) {
  const [range, setRange] = useState<NodeLoadRange>(DAY);
  const taken = useResource(`${name}#${range}`, (signal) => nodeLegacyApi.load(name, range, signal));
  const ready = taken.status === 'ready' ? taken.data : null;
  const charts = useMemo(() => (ready === null ? null : foldLoad(ready)), [ready]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {NODE_LOAD_RANGES.map((option) => (
          <Chip key={option} active={range === option} onClick={() => setRange(option)}>
            {copy.nodeLoadRange[option]}
          </Chip>
        ))}
        {charts?.asOfSec ? (
          <span className="ml-auto text-micro text-[var(--muted-foreground)]">
            {formatWhenAgo(charts.asOfSec)}
          </span>
        ) : null}
      </div>

      {charts === null ? (
        <EmptyLine message={taken.status === 'error' ? taken.message : copy.loading} />
      ) : !hasLoad(charts) ? (
        <EmptyLine message={copy.nodeNoLoad} />
      ) : (
        <Charts charts={charts} range={range} />
      )}
    </div>
  );
}

/**
 * Two measured facts and four charts.
 *
 * The facts go above the shapes rather than beside them because they are the
 * two numbers a person came here for — what the transit bill will say, and
 * how many connections the box was actually holding — and everything below is
 * the context for those two.
 */
function Charts({ charts, range }: { charts: LoadCharts; range: NodeLoadRange }) {
  const at = charts.asOfSec;
  const clock = (point: number) => (
    range === DAY ? formatClock(point) : copy.nodeWhenBoth(formatDate(point), formatClock(point))
  );
  const share = (value: number) => formatPercent(value / 100);
  const rate = (value: number) => copy.nodeLoadRate(formatBytesMeasured(value));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-x-8 sm:grid-cols-2">
        <Fact
          label={copy.nodeLoadBandwidth}
          measured={fact(charts.bandwidth95 === null ? null : rate(charts.bandwidth95), at)}
        />
        <Fact
          label={copy.nodeLoadConnections}
          measured={fact(
            charts.peakConnections === null
              ? null
              : copy.nodeLoadConnCount(formatCount(charts.peakConnections)),
            at,
          )}
        />
      </div>

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Chart title={copy.nodeLoadCharts.cpu} points={charts.cpu} format={share} when={clock} />
        <Chart title={copy.nodeLoadCharts.memory} points={charts.memory} format={share} when={clock} />
        <Chart title={copy.nodeLoadCharts.netIn} points={charts.netIn} format={rate} when={clock} />
        <Chart title={copy.nodeLoadCharts.netOut} points={charts.netOut} format={rate} when={clock} />
      </div>

      <p className="text-micro text-[var(--muted-foreground)]">{copy.nodeLoadNote}</p>
    </div>
  );
}

/** A chart, its name, and its peak — the one value that is never hidden. */
function Chart({
  title,
  points,
  format,
  when,
}: {
  title: string;
  points: readonly SeriesPoint[];
  format: (value: number) => string;
  when: (at: number) => string;
}) {
  const known = points.filter((point): point is { t: number; v: number } => point.v !== null);
  const top = known.length === 0 ? null : Math.max(...known.map((point) => point.v));

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <span className="text-micro text-[var(--muted-foreground)]">{title}</span>
        <span className="ml-auto font-mono text-micro text-[var(--muted-foreground)]">
          {top === null ? copy.missing : copy.nodeLoadPeak(format(top))}
        </span>
      </div>
      {known.length < 2 ? (
        <EmptyLine message={copy.nodeNoLoad} />
      ) : (
        <TimeSeries points={points} format={format} when={when} label={title} />
      )}
    </div>
  );
}

/** Everything in this block was measured by the agent, or was not measured. */
function fact(value: string | null, at: number | null): Measured<string | null> {
  const who = sourceWord('komari');
  return value === null ? absent(who) : measured(value, at, who);
}
