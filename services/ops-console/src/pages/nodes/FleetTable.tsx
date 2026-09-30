import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { NodeLifecycle, NodeSummaryDto, QuotaLevel } from '@contract';
import { Chip } from '@/components/ops/Chip';
import { Meter } from '@/components/ops/Meter';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { Spark } from '@/components/ops/Spark';
import { StatusWord, type Tone } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatPercent, formatRate, formatTally } from '@/lib/display';
import type { NodeLoadRow } from '@/lib/fleet-load';
import { openNodePage } from '@/lib/hash-route';
import { formatDeadline } from '@/lib/node-detail';
import { nowSec } from '@/lib/clock';
import {
  countLine,
  lifecycleCounts,
  NODE_FILTERS,
  NODE_LIFECYCLE_CHIPS,
  nodeWord,
  selectLifecycle,
  selectNodes,
  type NodeFilterId,
} from '@/lib/selectors';
import type { NodeQuality } from '@/lib/slo';
import { cn } from '@/lib/utils';
import type { FleetNodeDto } from '@/lib/types';
import { toNodeView, type NodeView } from '../node-metrics';

const words = copy.nodesBoard.table;
const cols = words.columns;
const ALL = 'all';
type HealthFilter = NodeFilterId | typeof ALL;
/** A renewal inside a week is the one date on the row that asks for action. */
const RENEW_SOON_SEC = 7 * 86_400;
const TONE_RANK: Record<Tone, number> = { sev: 0, warn: 1, rem: 2, info: 3, unk: 4, ok: 5 };
const QUOTA_TONE: Record<QuotaLevel, Tone | null> = { ok: null, chore: 'rem', warn: 'warn', severe: 'sev' };

/**
 * Every machine as one row, trouble first. The health filter and the
 * lifecycle chips read the engine's words through `lib/selectors`, so a
 * filter that says 7 lists 7 rows (R4); the search narrows what is left.
 * A row opens the node page; the name is the keyboard's link to it.
 */
export function FleetTable({
  nodes,
  state,
  facts,
  load,
  quality,
  showPath,
  phone,
  asOfSec,
  onRetry,
}: {
  nodes: readonly NodeSummaryDto[];
  state: PanelState;
  facts: Map<string, FleetNodeDto>;
  load: Map<string, NodeLoadRow> | null;
  quality: Map<string, NodeQuality> | null;
  showPath: boolean;
  phone: boolean;
  asOfSec: number | null;
  onRetry: () => void;
}) {
  const [health, setHealth] = useState<HealthFilter>(ALL);
  const [lifecycle, setLifecycle] = useState<NodeLifecycle | null>(null);
  const [query, setQuery] = useState('');

  const onShow = useMemo(() => selectLifecycle(nodes, lifecycle), [nodes, lifecycle]);
  const counts = useMemo(() => countLine(onShow), [onShow]);
  const lifecycles = useMemo(() => lifecycleCounts(nodes), [nodes]);
  const views = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return selectNodes(onShow, health === ALL ? null : health)
      .filter((node) => !needle || [node.name, node.displayName, node.region, node.provider]
        .some((text) => text?.toLowerCase().includes(needle)))
      .map((node) => toNodeView(node, facts.get(node.name)))
      .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  }, [onShow, health, query, facts]);

  const options = [
    { value: ALL as HealthFilter, label: words.all, count: onShow.length },
    ...NODE_FILTERS.filter((id) => counts[id] > 0 || health === id)
      .map((id) => ({ value: id as HealthFilter, label: nodeWord(id), count: counts[id] })),
  ];
  const bodyState: PanelState = state === 'ready' && nodes.length === 0 ? 'empty' : state;

  return (
    <Panel
      title={words.title}
      description={words.lead}
      source={words.source}
      asOfSec={asOfSec}
      state={bodyState}
      emptyText={words.empty}
      onRetry={onRetry}
      bodyHeight={240}
      actions={(
        <label className="nodes-search">
          <Search size={13} aria-hidden />
          <input
            type="search"
            aria-label={words.search}
            placeholder={words.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
    >
      <div className="nodes-filters">
        <Segmented label={words.filterLabel} value={health} options={options} onChange={setHealth} />
        <div className="flex flex-wrap items-center gap-2">
          {NODE_LIFECYCLE_CHIPS.map((id) => (
            <Chip
              key={id}
              active={lifecycle === id}
              count={lifecycles[id]}
              onClick={() => {
                setLifecycle((current) => (current === id ? null : id));
                setHealth(ALL);
              }}
            >
              {copy.nodeLifecycle[id]}
            </Chip>
          ))}
        </div>
      </div>

      {views.length === 0 ? (
        <p className="nodes-nomatch text-[var(--muted-foreground)]">{words.noMatch}</p>
      ) : (
        <div className="nodes-table-wrap">
          <table className="quality-table nodes-table">
            <thead>
              <tr>
                {phone ? <th scope="col">{cols.status}</th> : null}
                <th scope="col">{cols.node}</th>
                {phone ? null : <th scope="col">{cols.status}</th>}
                {phone ? null : <th scope="col" className="num">{cols.online}</th>}
                {phone ? null : <th scope="col" className="nodes-cpu-col">{cols.cpu}</th>}
                {phone ? null : <th scope="col" className="num nodes-wide-col">{cols.memory}</th>}
                <th scope="col" className="nodes-quota-col">{cols.traffic}</th>
                {phone || !showPath ? null : <th scope="col" className="nodes-wide-col">{cols.forward}</th>}
                {phone ? null : <th scope="col" className="num">{cols.rate}</th>}
                {phone ? null : <th scope="col" className="num nodes-wide-col">{cols.renew}</th>}
              </tr>
            </thead>
            <tbody>
              {views.map((view) => (
                <Row
                  key={view.node.name}
                  view={view}
                  load={load?.get(view.node.name) ?? null}
                  loadRead={load !== null}
                  quality={quality?.get(view.node.name) ?? null}
                  qualityRead={quality !== null}
                  showPath={showPath}
                  phone={phone}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Row({
  view,
  load,
  loadRead,
  quality,
  qualityRead,
  showPath,
  phone,
}: {
  view: NodeView;
  load: NodeLoadRow | null;
  loadRead: boolean;
  quality: NodeQuality | null;
  qualityRead: boolean;
  showPath: boolean;
  phone: boolean;
}) {
  const { node } = view;
  const status = (
    <td>
      <StatusWord word={view.word} tone={view.tone} reason={view.reason} />
    </td>
  );
  const outage = (quality?.outageMin ?? 0) > 0;
  const renew = view.renew.value;
  const renewSoon = renew !== null && renew - nowSec() < RENEW_SOON_SEC;

  return (
    <tr className={cn('quality-row', view.retired && 'nodes-row-retired')} onClick={() => openNodePage(node.name)}>
      {phone ? status : null}
      <td className="nodes-name">
        <a href={`#/nodes/${encodeURIComponent(node.name)}`} onClick={(event) => event.stopPropagation()}>
          {node.displayName ?? node.name}
        </a>
        <span className="nodes-sub">
          {[view.region, node.provider].filter(Boolean).join(' · ')}
          {view.lifecycle === 'listed' ? null : <span className="ops-tag">{copy.nodeLifecycle[view.lifecycle]}</span>}
        </span>
      </td>
      {phone ? null : status}
      {phone ? null : (
        <td className="num">
          <Value value={view.occupancy.value === null ? null : formatTally(view.occupancy.value)} source={view.occupancy.source} mono />
        </td>
      )}
      {phone ? null : (
        <td className="nodes-cpu-col">
          <span className="nodes-cpu">
            <span className="nodes-cpu-spark">
              {load ? <Spark points={load.cpu} domain={[0, 100]} height={18} /> : null}
            </span>
            <Value
              value={load?.cpuNow == null ? null : formatPercent(load.cpuNow / 100)}
              source={loadRead ? copy.nodesBoard.load.source : copy.loading}
              mono
              tier="body"
            />
          </span>
        </td>
      )}
      {phone ? null : (
        <td className="num nodes-wide-col">
          {load?.memoryNow == null ? copy.missing : formatPercent(load.memoryNow / 100)}
        </td>
      )}
      <td className="nodes-quota-col">
        <QuotaCell view={view} />
      </td>
      {phone || !showPath ? null : (
        <td className="nodes-wide-col">
          <Value value={view.forward.value} source={view.forward.source} tier="body" />
        </td>
      )}
      {phone ? null : (
        <td className={cn('num', outage && 'tone-sev tone-fg')}>
          {quality === null ? (qualityRead ? copy.missing : copy.loading) : formatRate(quality.rate)}
        </td>
      )}
      {phone ? null : (
        <td className={cn('num nodes-wide-col', renewSoon && 'tone-warn tone-fg')}>
          {renew === null ? copy.missing : formatDeadline(renew)}
        </td>
      )}
    </tr>
  );
}

function QuotaCell({ view }: { view: NodeView }) {
  const used = view.used.value;
  const level = view.node.quota.value?.level ?? 'ok';
  if (view.quota === null || view.quota <= 0) {
    return used === null
      ? <span className="text-fine">{words.noQuota}</span>
      : <span className="font-mono text-body">{formatBytesMeasured(used)}</span>;
  }
  const ratio = used === null ? null : Math.min(1, used / view.quota);
  const tone = QUOTA_TONE[level];
  return (
    <span className="nodes-quota">
      <Meter ratio={ratio} tone={tone} />
      <span className={cn('font-mono text-body', tone && tone !== 'rem' && `tone-${tone} tone-fg`)}>
        {used === null ? copy.missing : words.quotaOf(formatBytesMeasured(used), formatPercent(ratio))}
      </span>
    </span>
  );
}
