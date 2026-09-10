import { useMemo, useState } from 'react';
import { LayoutGrid, Table as TableIcon } from 'lucide-react';
import type { NodeLifecycle, NodeSummaryDto, SystemHealthDto } from '@contract';
import { Chip } from '@/components/ops/Chip';
import { CountText } from '@/components/ops/CountText';
import { type TableState } from '@/components/ops/DataTable';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { PageNote } from '@/components/ops/PageNote';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { closeNode, openNode, openNodePage } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useIsPhone } from '@/lib/use-phone';
import {
  countFragments,
  countLine,
  lifecycleCounts,
  NODE_LIFECYCLE_CHIPS,
  selectLifecycle,
  selectNodes,
  topFragments,
  type NodeFilter,
  type NodeFilterId,
} from '@/lib/selectors';
import { newestFetch, type Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import type { Tone } from '@/components/ops/StatusWord';
import type { FleetNodeDto } from '@/lib/types';
import type { FleetState } from '@/lib/use-fleet';
import { NodeCardGrid } from './NodeCardGrid';
import { NodeTable } from './NodeTable';
import { toNodeView } from './node-metrics';

/** How many fragments of the count sentence fit on a phone before it eats the page. */
const PHONE_FRAGMENTS = 3;

export default function NodesPage({
  nodes,
  health,
  fleet,
  selected,
}: {
  /** The engine's judgement of the fleet. The page shows this and nothing else. */
  nodes: Resource<NodeSummaryDto[]>;
  health: Resource<SystemHealthDto>;
  /** The legacy read, for the drawer's flat facts only. */
  fleet: FleetState;
  selected: string | null;
}) {
  const privacy = usePrivacy();
  const phone = useIsPhone();
  const [filter, setFilter] = useState<NodeFilter>(null);
  const [lifecycle, setLifecycle] = useState<NodeLifecycle | null>(null);
  const [chosen, setChosen] = useState<'cards' | 'table'>('cards');
  /**
   * One card per screen at 390 px is a scroll through forty-five screens to
   * find the one that is broken. Three columns of the table — the word, the
   * name, the quota — fit and answer the same question in one screen, so the
   * phone gets the table whatever the toggle says, and the toggle goes.
   */
  const view = phone ? 'table' : chosen;

  const all = useMemo(() => (nodes.status === 'ready' ? nodes.data : []), [nodes]);
  const facts = useMemo(() => {
    const out = new Map<string, FleetNodeDto>();
    if (fleet.status !== 'ready') return out;
    for (const node of fleet.fleet.nodes) out.set(node.name, node);
    return out;
  }, [fleet]);

  /**
   * A retired machine is inventory, not fleet.
   *
   * A machine that was taken out of service answers no probe, so leaving it in
   * the list filled the page with alarms nobody can act on — and made the count
   * sentence disagree with the daily page, which had already stopped raising
   * incidents for it. It is one chip away, and the chip carries its count.
   */
  const onShow = useMemo(() => selectLifecycle(all, lifecycle), [all, lifecycle]);
  const lifecycles = useMemo(() => lifecycleCounts(all), [all]);
  const counts = useMemo(() => countLine(onShow), [onShow]);
  const fragments = useMemo(
    () => {
      const all = countFragments(counts);
      return phone ? topFragments(all, PHONE_FRAGMENTS, filter) : all;
    },
    [counts, phone, filter],
  );
  const rows = useMemo(() => selectNodes(onShow, filter), [onShow, filter]);
  const views = useMemo(
    () => rows.map((node) => toNodeView(node, facts.get(node.name))),
    [rows, facts],
  );
  /**
   * The client-side leg is measured for some machines and not others. The
   * column comes back the moment one node in the whole fleet has a
   * measurement — the condition is the data, not a flag somebody has to
   * remember to flip — and the nodes without one show the em dash and who
   * should have measured it.
   */
  const pathWired = useMemo(() => all.some((node) => node.forwardWorst.value !== null), [all]);
  const selectedView = useMemo(() => {
    const found = all.find((node) => node.name === selected);
    return found ? toNodeView(found, facts.get(found.name)) : null;
  }, [all, selected, facts]);

  const tableState: TableState = nodes.status === 'loading'
    ? 'loading'
    : nodes.status === 'error'
      ? 'error'
      : views.length === 0
        ? 'empty'
        : 'ready';

  return (
    <div className="page-wrap">
      <div className="page-head">
        {/* R2 reaches the headline too: a fleet that failed to load has no counts,
            and a zero count would be a measurement the console never took. */}
        {nodes.status === 'ready' ? (
          <p className="text-verdict">
            {fragments.map((id, index) => (
              <span key={id}>
                {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
                <CountBit
                  id={id}
                  active={filter === id}
                  count={counts[id]}
                  render={(values) => copy.count[id](values[0])}
                  onClick={() => setFilter((current) => (current === id ? null : id))}
                />
              </span>
            ))}
          </p>
        ) : (
          <p className="text-verdict text-[var(--muted-foreground)]">
            {nodes.status === 'loading' ? copy.loading : copy.loadError}
          </p>
        )}

        <PageNote
          fetchedAt={newestFetch(nodes, health, fleet)}
          backfill={health.status === 'ready' ? health.data.backfill : null}
        />

        {nodes.status === 'ready' && all.length > 0 && !pathWired ? (
          <p className="text-body text-[var(--muted-foreground)]">{copy.pathNotWired}</p>
        ) : null}

        <div className="toolbar-row">
          {NODE_LIFECYCLE_CHIPS.map((id) => (
            <Chip
              key={id}
              active={lifecycle === id}
              count={lifecycles[id]}
              onClick={() => {
                setLifecycle((current) => (current === id ? null : id));
                setFilter(null);
              }}
            >
              {copy.nodeLifecycle[id]}
            </Chip>
          ))}

          {phone ? null : (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-pressed={view === 'cards'}
                className={cn(
                  'flex h-8 items-center gap-1 rounded-[999px] border border-[var(--hairline)] px-3 text-micro',
                  view === 'cards' && 'bg-[var(--accent)] text-white',
                )}
                onClick={() => setChosen('cards')}
              >
                <LayoutGrid size={12} />
                {copy.viewCards}
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                className={cn(
                  'flex h-8 items-center gap-1 rounded-[999px] border border-[var(--hairline)] px-3 text-micro',
                  view === 'table' && 'bg-[var(--accent)] text-white',
                )}
                onClick={() => setChosen('table')}
              >
                <TableIcon size={12} />
                {copy.viewTable}
              </button>
            </div>
          )}
        </div>
      </div>

      {nodes.status === 'error' && !nodes.sessionExpired ? (
        <Empty message={nodes.message || copy.loadError} />
      ) : view === 'cards' ? (
        nodes.status === 'loading' ? (
          <Empty message={copy.loading} />
        ) : views.length === 0 ? (
          <Empty message={copy.emptyList} />
        ) : (
          <NodeCardGrid
            views={views}
            selected={selected}
            showPath={pathWired}
            onOpen={openNode}
            onOpenPage={openNodePage}
          />
        )
      ) : (
        <NodeTable
          views={views}
          selected={selected}
          showPath={pathWired}
          phone={phone}
          state={tableState}
          errorMessage={nodes.status === 'error' ? nodes.message : undefined}
          onOpen={openNode}
        />
      )}

      <DetailDrawer
        open={Boolean(selectedView)}
        title={selectedView?.node.name ?? ''}
        action={selectedView ? (
          <button
            type="button"
            className="text-micro text-[color:var(--accent)] hover:underline"
            onClick={() => openNodePage(selectedView.node.name)}
          >
            {copy.nodeOpenPage}
          </button>
        ) : null}
        onClose={closeNode}
      >
        {selectedView ? (
          <>
            <StatusWord
              word={selectedView.word}
              tone={selectedView.tone}
              reason={selectedView.reason}
              className="self-start"
            />
            <Fact label={copy.facts.ip} measured={selectedView.ip} render={privacy.ip} />
            <Fact label={copy.facts.os} measured={selectedView.os} />
            <Fact label={copy.facts.provider} measured={selectedView.provider} />
            <Fact label={copy.facts.tags} measured={selectedView.tags} />
            <Fact label={copy.facts.ports} measured={selectedView.ports} />
          </>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

/**
 * A fragment of the count sentence. It has to read as prose and behave as a
 * control at once: a real button so the keyboard and screen readers get it,
 * `aria-pressed` for the filter state, an underline on hover, and a 2 px rule
 * in the fragment's own tone once it is on.
 */
const FRAGMENT_TONE: Record<NodeFilterId, Tone | 'none'> = {
  lost: 'sev',
  blocked: 'sev',
  degraded: 'warn',
  ok: 'none',
  unmeasured: 'unk',
};

function CountBit({
  id,
  active,
  count,
  render,
  onClick,
}: {
  id: NodeFilterId;
  active: boolean;
  count: number;
  render: (values: number[]) => string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
      onClick={onClick}
    >
      <CountText values={[count]} render={render} />
    </button>
  );
}

