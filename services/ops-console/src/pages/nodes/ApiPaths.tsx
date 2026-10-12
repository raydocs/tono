import type { ApiPathRowDto, ApiPathsDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { measured } from '@/components/ops/measured';
import { Section } from '@/components/ops/Section';
import { MeasuredValue } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatRate } from '@/lib/display';
import type { Resource } from '@/lib/use-resource';

const words = copy.apiPaths;

/**
 * Last week's control-plane arrivals per client ASN and path (decision 080).
 *
 * The success rate is only what clients that report their failed paths said;
 * with none of them on a row it reads as no data, never 100 %. A request that came
 * through a relay, the tunnel or an exit node shows the node's network, so its
 * ASN is unknown rather than the node's.
 */
export function ApiPaths({ paths }: { paths: Resource<ApiPathsDto> }) {
  return (
    <Section title={words.title}>
      <p className="text-fine text-[var(--muted-foreground)]">{words.lead}</p>
      {paths.status === 'loading' ? <EmptyLine message={copy.loading} /> : null}
      {paths.status === 'error' ? <EmptyLine message={words.loadFailed} /> : null}
      {paths.status === 'ready' && paths.data.rows.length === 0 ? <EmptyLine message={words.empty} /> : null}
      {paths.status === 'ready' && paths.data.rows.length > 0 ? <PathTable rows={paths.data.rows} /> : null}
    </Section>
  );
}

function PathTable({ rows }: { rows: readonly ApiPathRowDto[] }) {
  const cols = words.columns;
  return (
    <table className="quality-table">
      <thead>
        <tr>
          <th scope="col">{cols.asn}</th>
          <th scope="col">{cols.path}</th>
          <th scope="col" className="num">{cols.arrived}</th>
          <th scope="col" className="num">{cols.failed}</th>
          <th scope="col" className="num">{cols.rate}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.asn ?? 0}:${row.path}`}>
            {/* The organisation wraps under the number so a long name cannot push a phone sideways. */}
            <td className="break-words">
              <span className="whitespace-nowrap">{row.asn === null ? words.unknownAsn : words.asn(row.asn)}</span>
              {row.asOrg ? <span className="block text-micro text-[var(--muted-foreground)]">{row.asOrg}</span> : null}
            </td>
            <td className="whitespace-nowrap">{words.paths[row.path]}</td>
            <td className="num">{formatCount(row.arrived)}</td>
            <td className="num">{formatCount(row.fail)}</td>
            <td className="num">
              {/* The wire source is always client telemetry; the word under a gap says why it is a gap. */}
              <MeasuredValue
                measured={measured(row.successRate.value, row.successRate.asOfSec, words.noReports)}
                format={formatRate}
                mono
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
