import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { MetricCard } from '@/components/ops/MetricCard';
import { QuotaGauge } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatWhen, formatWhenAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { Enter } from '@/app/Enter';
import type { NodeView } from './node-metrics';

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
        <Enter key={view.node.name} delay={index * 0.03}>
          <motion.article
            whileHover={reduce ? undefined : { y: -2 }}
            transition={{ duration: 0.16 }}
            className={cn(
              'node-card cursor-pointer rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]',
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
        </Enter>
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
