import { useMemo } from 'react';
import type { ConnectionEventDto } from '@contract';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { isFailure, isSuccess } from '@/lib/codes';
import { formatCount, formatLatency, formatPercent } from '@/lib/display';

type Cell = { ok: number; fail: number; elapsed: number[] };

const MIN_SAMPLES = 1;

/**
 * 运营商 × 地区, derived from the timeline rather than fetched.
 *
 * There is no endpoint for this matrix and there should not be: it is the
 * same events the timeline already loaded, counted two ways. Asking the
 * Worker for a second, separately-computed version of the same numbers is how
 * a page ends up disagreeing with itself (R4).
 *
 * Rows whose upload went through the tunnel are dropped: their ASN is the
 * exit's, and a Tokyo carrier in a mainland matrix is worse than a gap.
 */
function build(events: readonly ConnectionEventDto[]) {
  const carriers = new Set<string>();
  const regions = new Set<string>();
  const cells = new Map<string, Cell>();
  for (const row of events) {
    if (row.edgeViaExit) continue;
    if (!row.edgeAsOrg || !row.edgeRegion) continue;
    if (!isSuccess(row.kind) && !isFailure(row.kind)) continue;
    carriers.add(row.edgeAsOrg);
    regions.add(row.edgeRegion);
    const key = `${row.edgeAsOrg}|${row.edgeRegion}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { ok: 0, fail: 0, elapsed: [] };
      cells.set(key, cell);
    }
    if (isSuccess(row.kind)) cell.ok += 1;
    else cell.fail += 1;
    if (row.elapsedMs !== null) cell.elapsed.push(row.elapsedMs);
  }
  return {
    carriers: [...carriers].sort((a, b) => a.localeCompare(b)),
    regions: [...regions].sort((a, b) => a.localeCompare(b, 'zh')),
    cells,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function CarrierMatrix({ events }: { events: readonly ConnectionEventDto[] }) {
  const matrix = useMemo(() => build(events), [events]);
  const empty = matrix.carriers.length === 0 || matrix.regions.length === 0;

  return (
    <Section
      title={copy.customerSections.carriers}
      aside={<span className="text-micro text-[var(--muted-foreground)]">{copy.timelineFilters.week}</span>}
    >
      {empty ? <Empty message={copy.noCarrierPaths} /> : (
        <div className="overflow-x-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="data-row border-b border-[var(--hairline)]">
                <th className="px-3 text-left text-micro font-medium text-[var(--muted-foreground)]">
                  {copy.carrierMatrix.carrier}
                </th>
                {matrix.regions.map((region) => (
                  <th
                    key={region}
                    className="px-3 text-right text-micro font-medium whitespace-nowrap text-[var(--muted-foreground)]"
                  >
                    {region}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.carriers.map((carrier) => (
                <tr key={carrier} className="data-row border-b border-[var(--hairline)] last:border-b-0">
                  <td className="px-3 whitespace-nowrap">{carrier}</td>
                  {matrix.regions.map((region) => (
                    <td key={region} className="px-3 text-right whitespace-nowrap">
                      <MatrixCell cell={matrix.cells.get(`${carrier}|${region}`)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/**
 * Success rate over median time, with the sample count in the tooltip. A cell
 * with nothing behind it is the em dash — a carrier this customer never used
 * from this province is not a 0 % success rate.
 */
function MatrixCell({ cell }: { cell: Cell | undefined }) {
  const total = cell ? cell.ok + cell.fail : 0;
  if (!cell || total < MIN_SAMPLES) {
    return <span className="font-mono text-[var(--muted-foreground)]">{copy.missing}</span>;
  }
  const mid = median(cell.elapsed);
  return (
    <span
      className="inline-flex flex-col items-end leading-tight"
      title={`${copy.carrierMatrix.samples} ${formatCount(total)}`}
    >
      <span className="font-mono">{formatPercent(cell.ok / total)}</span>
      <span className="font-mono text-micro text-[var(--muted-foreground)]">
        {mid === null ? copy.missing : formatLatency(mid)}
      </span>
    </span>
  );
}
