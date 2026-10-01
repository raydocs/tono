import type { CarrierKey, ForwardPathDto, Measured, ReturnPathDto } from '@contract';
import { Panel } from '@/components/ops/Panel';
import { ProbeStrip } from '@/components/ops/ProbeStrip';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatLatency, formatLoss, formatPercent } from '@/lib/display';
import { probesOf } from '@/lib/probes';
import { sourceWord } from '@/lib/sources';
import type { CarrierPingMapDto } from '@/lib/types';

const words = copy.nodeBoard.paths;
/** The hub sweeps every five minutes; three missed sweeps is late. */
const STALE_AFTER_SEC = 15 * 60;

/**
 * The two directions, side by side, because they answer different questions
 * and the old console conflated them: the return path is the hub pinging the
 * machine, the forward path is what the customers' own clients reported. A node
 * can be perfect on the right and unusable on the left, which is exactly the
 * case the note under the pair exists to keep in view.
 */
export function NodePaths({
  forward,
  back,
  pings,
}: {
  forward: Measured<ForwardPathDto[]>;
  back: Measured<ReturnPathDto[]>;
  /** The hub's recent rounds per carrier, from the legacy read; null when it has not answered. */
  pings: CarrierPingMapDto;
}) {
  const forwardRows = forward.value.filter((row) => row.attempts > 0);
  const backRows = back.value.filter((row) => row.samples > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="node-paths-grid">
        <Panel
          title={copy.nodeSections.forward}
          description={words.forwardLead}
          source={sourceWord(forward.source)}
          asOfSec={forward.asOfSec}
          state={forwardRows.length === 0 ? 'empty' : 'ready'}
          emptyText={copy.nodeNoForward}
          bodyHeight={96}
        >
          <ForwardTable rows={forwardRows} source={sourceWord(forward.source)} />
        </Panel>
        <Panel
          title={copy.nodeSections.back}
          description={words.backLead}
          source={sourceWord(back.source)}
          asOfSec={back.asOfSec}
          staleAfterSec={STALE_AFTER_SEC}
          state={backRows.length === 0 ? 'empty' : 'ready'}
          emptyText={copy.nodeNoReturn}
          bodyHeight={96}
        >
          <ReturnTable rows={backRows} pings={pings} source={sourceWord(back.source)} />
        </Panel>
      </div>
      <p className="text-fine">{copy.nodePathNote}</p>
    </div>
  );
}

function carrierName(carrier: CarrierKey): string {
  return copy.nodeCarrier[carrier];
}

function ForwardTable({ rows, source }: { rows: readonly ForwardPathDto[]; source: string }) {
  const cols = copy.nodeForwardColumns;
  return (
    <table className="quality-table">
      <thead>
        <tr>
          <th scope="col">{cols.carrier}</th>
          <th scope="col" className="num">{cols.okRate}</th>
          <th scope="col" className="num">{cols.tcp}</th>
          <th scope="col" className="quality-p50-col">{cols.worst}</th>
          <th scope="col" className="num">{cols.tries}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.carrier}>
            <td className="whitespace-nowrap">{carrierName(row.carrier)}</td>
            <td className="num">
              <Value value={row.successRate === null ? null : formatPercent(row.successRate)} source={source} mono />
            </td>
            <td className="num">
              <Value value={row.medianTcpMs === null ? null : formatLatency(row.medianTcpMs)} source={source} mono />
            </td>
            <td className="quality-p50-col node-path-failure">
              <span className="block truncate" title={row.topFailure ?? undefined}>
                {row.topFailure ?? copy.missing}
              </span>
            </td>
            <td className="num">{copy.nodeTries(formatCount(row.attempts), formatCount(row.users))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReturnTable({
  rows,
  pings,
  source,
}: {
  rows: readonly ReturnPathDto[];
  pings: CarrierPingMapDto;
  source: string;
}) {
  const cols = copy.nodeReturnColumns;
  return (
    <table className="quality-table">
      <thead>
        <tr>
          <th scope="col">{cols.carrier}</th>
          <th scope="col" className="num">{cols.loss}</th>
          <th scope="col" className="num">{cols.latency}</th>
          <th scope="col" className="node-probe-col">{words.probes}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const history = row.carrier === 'other' ? [] : pings?.[row.carrier]?.history ?? [];
          return (
            <tr key={row.carrier}>
              <td className="whitespace-nowrap">{carrierName(row.carrier)}</td>
              <td className="num">
                <Value value={row.lossPct === null ? null : formatLoss(row.lossPct)} source={source} mono />
              </td>
              <td className="num">
                <Value value={row.latencyMs === null ? null : formatLatency(row.latencyMs)} source={source} mono />
              </td>
              <td className="node-probe-col">
                {history.length === 0 ? copy.missing : <ProbeStrip probes={probesOf(history)} className="justify-end" />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
