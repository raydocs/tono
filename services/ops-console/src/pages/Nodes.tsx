import { useMemo, useState } from 'react';
import type { NodeSummaryDto, SystemHealthDto } from '@contract';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { PageNote } from '@/components/ops/PageNote';
import type { PanelState } from '@/components/ops/Panel';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { ledgerApi } from '@/lib/api-ledger';
import { sloApi } from '@/lib/api-slo';
import { nowSec } from '@/lib/clock';
import { foldFleetLoad } from '@/lib/fleet-load';
import { closeNode, openNodePage } from '@/lib/hash-route';
import { monthOf } from '@/lib/ledger';
import { nodeLegacyApi, type NodeLoadRange } from '@/lib/node-legacy';
import { usePrivacy } from '@/lib/privacy';
import { selectLifecycle } from '@/lib/selectors';
import { nodeQuality } from '@/lib/slo';
import { useIsPhone } from '@/lib/use-phone';
import { oldestFetch, useResource, type Resource } from '@/lib/use-resource';
import type { FleetNodeDto } from '@/lib/types';
import type { FleetState } from '@/lib/use-fleet';
import '@/styles/nodes.css';
import { toNodeView } from './node-metrics';
import { FleetBand } from './nodes/FleetBand';
import { FleetLoad } from './nodes/FleetLoad';
import { FleetTable } from './nodes/FleetTable';

/**
 * The nodes page: is the fleet healthy, busy, and worth what it costs.
 *
 * Headline numbers first, then the fleet's load over time, then every machine
 * as a row. Each block reads its own source and fails on its own — a
 * collector that is down empties the load panels, not the table. The
 * verdicts are the engine's and nothing here recomputes one (R4).
 *
 * `?node=` still opens the short drawer, because ⌘K lands there; a row on
 * this page goes straight to the node page, which is what the drawer was
 * only ever a step towards.
 */
export default function NodesPage({
  nodes,
  health,
  fleet,
  selected,
  query = null,
}: {
  nodes: Resource<NodeSummaryDto[]> & { reload: () => void };
  health: Resource<SystemHealthDto>;
  /** The legacy read, for the flat facts only. */
  fleet: FleetState;
  selected: string | null;
  query?: string | null;
}) {
  const privacy = usePrivacy();
  const phone = useIsPhone();
  const [range, setRange] = useState<NodeLoadRange>('24h');
  // The day window feeds both the charts and each row's CPU line; the week is
  // only fetched once somebody asks for it.
  const day = useResource('fleet-load-24h', (signal) => nodeLegacyApi.fleetLoad('24h', signal));
  const week = useResource(range === '7d' ? 'fleet-load-7d' : null, (signal) => nodeLegacyApi.fleetLoad('7d', signal));
  const load = range === '24h' ? day : week;
  const slo = useResource('nodes-slo-7d', (signal) => sloApi.get({ range: '7d' }, signal));
  const month = monthOf(nowSec());
  const ledger = useResource(`ledger-month-${month}`, (signal) => ledgerApi.month(month, signal));

  const all = useMemo(() => (nodes.status === 'ready' ? nodes.data : []), [nodes]);
  const inService = useMemo(() => selectLifecycle(all, null), [all]);
  const facts = useMemo(() => {
    const out = new Map<string, FleetNodeDto>();
    if (fleet.status !== 'ready') return out;
    for (const node of fleet.fleet.nodes) out.set(node.name, node);
    return out;
  }, [fleet]);
  const perNode = useMemo(
    () => (day.status === 'ready' ? foldFleetLoad(day.data).perNode : null),
    [day],
  );
  const quality = useMemo(() => {
    if (slo.status !== 'ready') return null;
    return new Map(nodeQuality(slo.data.items).map((row) => [row.node, row]));
  }, [slo]);
  /**
   * The customer-side leg comes back as a column the moment one node in the
   * fleet has a measurement: the condition is the data, not a flag.
   */
  const pathWired = useMemo(() => all.some((node) => node.forwardWorst.value !== null), [all]);
  const tableState: PanelState = nodes.status === 'loading' ? 'loading' : nodes.status === 'error' ? 'error' : 'ready';
  const newest = all.reduce<number | null>((top, node) => Math.max(top ?? 0, node.updatedAt), null);

  const selectedView = useMemo(() => {
    const found = all.find((node) => node.name === selected);
    return found ? toNodeView(found, facts.get(found.name)) : null;
  }, [all, selected, facts]);

  return (
    <div className="page-wrap nodes-page">
      <header className="nodes-head">
        <p className="text-fine">{copy.nodesBoard.lead}</p>
        <PageNote
          fetchedAt={oldestFetch(nodes, health, fleet)}
          backfill={health.status === 'ready' ? health.data.backfill : null}
        />
        {nodes.status === 'ready' && all.length > 0 && !pathWired ? (
          <p className="text-fine">{copy.pathNotWired}</p>
        ) : null}
      </header>

      <FleetBand nodes={nodes} inService={inService} slo={slo} month={ledger} />

      {phone ? null : <FleetLoad load={load} range={range} onRange={setRange} />}

      <FleetTable
        nodes={all}
        state={tableState}
        facts={facts}
        load={perNode}
        quality={quality}
        showPath={pathWired}
        phone={phone}
        asOfSec={newest}
        onRetry={nodes.reload}
        initialQuery={query}
      />

      {/* On a phone the list is what the page is opened for, so the charts follow it. */}
      {phone ? <FleetLoad load={load} range={range} onRange={setRange} /> : null}

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
