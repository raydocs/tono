import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { MetricCard } from '@/components/ops/MetricCard';
import { QuotaGauge } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatWhen, formatWhenAgo } from '@/lib/display';
import { ENTER_SECONDS, HOVER_SECONDS, SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { NodeView } from './node-metrics';

/** Enough stagger to read as a sweep, capped so the last card is not late. */
const STAGGER = 0.03;
const STAGGER_CAP = 0.24;

export function NodeCardGrid({
  views,
  selected,
  showPath,
  onOpen,
}: {
  views: NodeView[];
  selected: string | null;
  /** False until one node has a measured client-side leg; see NodesPage. */
  showPath: boolean;
  onOpen: (name: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="grid grid-cols-1 gap-4 min-[960px]:grid-cols-2 min-[1280px]:grid-cols-3">
      {views.map((view, index) => (
        /**
         * The card is the grid item, not a wrapper around one: `layout` moves
         * the element the grid actually places, so clicking a count fragment
         * slides the matching cards up from wherever they were instead of redrawing
         * the grid from nothing. That continuity is the answer to "which ones
         * did it keep" — you watch them move rather than re-reading the page.
         */
        <motion.article
          key={view.node.name}
          layout={reduce ? false : 'position'}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={reduce ? undefined : { y: -2 }}
          transition={{
            duration: ENTER_SECONDS,
            delay: Math.min(index * STAGGER, STAGGER_CAP),
            ease: [0.16, 1, 0.3, 1],
            layout: SPRING,
            y: { duration: HOVER_SECONDS },
          }}
          className={cn(
            'node-card raised cursor-pointer rounded-[10px] bg-[var(--surface)]',
            selected === view.node.name && 'outline outline-1 outline-[var(--accent)]',
          )}
          role="button"
          tabIndex={0}
          aria-label={view.node.name}
          onClick={() => onOpen(view.node.name)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(view.node.name);
            }
          }}
        >
          <header className="flex items-baseline gap-2 border-b border-[var(--hairline)] px-4 py-3">
            <span className="min-w-0 truncate text-row">{view.node.name}</span>
            <span className="min-w-0 shrink truncate text-micro text-[var(--muted-foreground)]">
              {view.region}
            </span>
            <StatusWord word={view.health} size="row" className="ml-auto shrink-0 self-center" />
          </header>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
            <MetricCard
              icon={<Users size={13} strokeWidth={1.75} />}
              label={copy.occupancy}
              value={view.occupancy}
              tier="body"
              format={(n) => ({ number: formatCount(n), unit: copy.occupancyUnit })}
            />
            {showPath ? (
              <Cell label={copy.customerPath}>
                <Value value={view.path.value} source={view.path.source} tier="body" />
              </Cell>
            ) : null}

            <div className="col-span-2 min-w-0">
              <div className="text-micro text-[var(--muted-foreground)]">{copy.periodTraffic}</div>
              <QuotaGauge
                used={view.used}
                quota={view.quota}
                cycleStartSec={view.cycleStart}
                series={view.trafficSeries}
                className="mt-0.5"
              />
            </div>

            <Cell label={copy.mainlandReturn}>
              <Value value={view.mainland.value} source={view.mainland.source} tier="body" mono />
            </Cell>
            <Cell label={copy.renew}>
              <Value
                value={view.renew.value == null ? null : formatDate(view.renew.value)}
                source={view.renew.source}
                tier="fine"
                mono
              />
            </Cell>

            <p className="col-span-2 truncate text-micro text-[var(--muted-foreground)]">
              {copy.lastMeasured}
              {' '}
              <span className="font-mono normal-case tracking-normal">
                {view.last.value == null
                  ? `${copy.missing} ${view.last.source}`
                  : `${formatWhenAgo(view.last.value)} · ${formatWhen(view.last.value)}`}
              </span>
            </p>
          </div>
        </motion.article>
      ))}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-micro text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}
