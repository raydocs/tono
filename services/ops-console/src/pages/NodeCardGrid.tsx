import { Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { MetricCard } from '@/components/ops/MetricCard';
import { QuotaGauge } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatWhen, formatWhenAgo } from '@/lib/display';
import { cn } from '@/lib/utils';
import { Enter } from '@/app/Enter';
import type { NodeView } from './node-metrics';

export function NodeCardGrid({
  views,
  selected,
  onOpen,
}: {
  views: NodeView[];
  selected: string | null;
  onOpen: (name: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {views.map((view, index) => (
        <Enter key={view.node.name} delay={index * 0.03}>
          <motion.article
            whileHover={reduce ? undefined : { y: -2 }}
            transition={{ duration: 0.16 }}
            className={cn(
              'cursor-pointer rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]',
              selected === view.node.name && 'outline outline-1 outline-[var(--accent)]',
            )}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(view.node.name)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(view.node.name);
              }
            }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
              <div className="min-w-0">
                <div className="truncate text-row">{view.node.name}</div>
                <div className="text-[11px] tracking-[0.04em] text-[var(--muted-foreground)]">{view.region}</div>
              </div>
              <StatusWord word={view.health} />
            </header>
            <div className="grid grid-cols-2">
              <div className="border-b border-r border-[var(--hairline)] p-4">
                <MetricCard
                  icon={<Users size={14} />}
                  label={copy.occupancy}
                  value={view.occupancy}
                  format={(n) => ({ number: formatCount(n), unit: copy.occupancyUnit })}
                  tone="info"
                  className="border-0 bg-transparent p-0"
                />
              </div>
              <div className="border-b border-[var(--hairline)] p-4">
                <div className="text-micro text-[var(--muted-foreground)]">{copy.periodTraffic}</div>
                <QuotaGauge
                  used={view.used}
                  quota={view.quota}
                  cycleStartSec={view.cycleStart}
                  className="mt-2"
                />
              </div>
              <Cell label={copy.customerPath} value={copy.missing} source={copy.notWired} />
              <Cell
                label={copy.mainlandReturn}
                value={view.mainland.value ?? copy.missing}
                source={view.mainland.value == null ? view.mainland.source : undefined}
                mono
              />
              <Cell
                label={copy.renew}
                value={view.renew.value == null ? copy.missing : formatDate(view.renew.value)}
                source={view.renew.value == null ? view.renew.source : undefined}
                mono
              />
              <Cell
                label={copy.lastMeasured}
                value={view.last.value == null ? copy.missing : `${formatWhenAgo(view.last.value)} · ${formatWhen(view.last.value)}`}
                source={view.last.value == null ? view.last.source : undefined}
                mono
              />
            </div>
          </motion.article>
        </Enter>
      ))}
    </div>
  );
}

function Cell({
  label,
  value,
  source,
  mono,
}: {
  label: string;
  value: string;
  source?: string;
  mono?: boolean;
}) {
  return (
    <div className="border-b border-r border-[var(--hairline)] p-4 last:border-r-0 [&:nth-child(2n)]:border-r-0">
      <div className="text-micro text-[var(--muted-foreground)]">{label}</div>
      <div className={cn('mt-2 text-row', mono && 'font-mono')}>{value}</div>
      {source ? <div className="mt-1 text-micro text-[var(--muted-foreground)]">{source}</div> : null}
    </div>
  );
}
