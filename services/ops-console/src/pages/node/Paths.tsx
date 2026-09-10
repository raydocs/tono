import type { CarrierKey, ForwardPathDto, Measured, ReturnPathDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatLatency, formatLoss, formatPercent, formatWhenAgo } from '@/lib/display';
import { sourceWord } from '@/lib/sources';
import { cn } from '@/lib/utils';

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
}: {
  forward: Measured<ForwardPathDto[]>;
  back: Measured<ReturnPathDto[]>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title={copy.nodeSections.forward}
          aside={<Stamp measured={forward} />}
          className="min-w-0"
        >
          <ForwardTable rows={forward.value} source={sourceWord(forward.source)} />
        </Section>
        <Section
          title={copy.nodeSections.back}
          aside={<Stamp measured={back} />}
          className="min-w-0"
        >
          <ReturnTable rows={back.value} source={sourceWord(back.source)} />
        </Section>
      </div>
      <p className="text-micro text-[var(--muted-foreground)]">{copy.nodePathNote}</p>
    </div>
  );
}

function Stamp({ measured }: { measured: Measured<unknown> }) {
  return (
    <span className="text-micro text-[var(--muted-foreground)]">
      {measured.asOfSec === null ? sourceWord(measured.source) : formatWhenAgo(measured.asOfSec)}
    </span>
  );
}

function carrierName(carrier: CarrierKey): string {
  return copy.nodeCarrier[carrier];
}

function ForwardTable({ rows, source }: { rows: readonly ForwardPathDto[]; source: string }) {
  const measuredRows = rows.filter((row) => row.attempts > 0);
  if (measuredRows.length === 0) return <EmptyLine message={copy.nodeNoForward} />;
  return (
    <Frame
      heads={[
        copy.nodeForwardColumns.carrier,
        copy.nodeForwardColumns.okRate,
        copy.nodeForwardColumns.tcp,
        copy.nodeForwardColumns.worst,
        copy.nodeForwardColumns.tries,
      ]}
    >
      {measuredRows.map((row) => (
        <tr key={row.carrier} className="data-row border-b border-[var(--hairline)] last:border-b-0">
          <td className="px-3 whitespace-nowrap">{carrierName(row.carrier)}</td>
          <td className="px-3 text-right font-mono whitespace-nowrap">
            <Value
              value={row.successRate === null ? null : formatPercent(row.successRate)}
              source={source}
              mono
            />
          </td>
          <td className="px-3 text-right font-mono whitespace-nowrap">
            <Value
              value={row.medianTcpMs === null ? null : formatLatency(row.medianTcpMs)}
              source={source}
              mono
            />
          </td>
          <td className="min-w-0 px-3">
            <span className="block truncate" title={row.topFailure ?? undefined}>
              {row.topFailure ?? copy.missing}
            </span>
          </td>
          <td className="px-3 text-right font-mono whitespace-nowrap">
            {copy.nodeTries(formatCount(row.attempts), formatCount(row.users))}
          </td>
        </tr>
      ))}
    </Frame>
  );
}

function ReturnTable({ rows, source }: { rows: readonly ReturnPathDto[]; source: string }) {
  const measuredRows = rows.filter((row) => row.samples > 0);
  if (measuredRows.length === 0) return <EmptyLine message={copy.nodeNoReturn} />;
  return (
    <Frame
      heads={[
        copy.nodeReturnColumns.carrier,
        copy.nodeReturnColumns.loss,
        copy.nodeReturnColumns.latency,
      ]}
    >
      {measuredRows.map((row) => (
        <tr key={row.carrier} className="data-row border-b border-[var(--hairline)] last:border-b-0">
          <td className="px-3 whitespace-nowrap">{carrierName(row.carrier)}</td>
          <td className="px-3 text-right font-mono whitespace-nowrap">
            <Value value={row.lossPct === null ? null : formatLoss(row.lossPct)} source={source} mono />
          </td>
          <td className="px-3 text-right font-mono whitespace-nowrap">
            <Value
              value={row.latencyMs === null ? null : formatLatency(row.latencyMs)}
              source={source}
              mono
            />
          </td>
        </tr>
      ))}
    </Frame>
  );
}

/** The same hairline frame both tables sit in; the first column is the only left-aligned one. */
function Frame({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="data-row border-b border-[var(--hairline)]">
            {heads.map((head, index) => (
              <th
                key={head}
                className={cn(
                  'px-3 text-micro font-medium whitespace-nowrap text-[var(--muted-foreground)]',
                  index === 0 || index === 3 ? 'text-left' : 'text-right',
                )}
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
