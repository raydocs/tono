import { useMemo } from 'react';
import type { DestinationRowDto, RouteKind } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, splitBytes } from '@/lib/display';

type Merged = {
  id: string;
  etld1: string;
  route: RouteKind;
  node: string | null;
  connections: number;
  bytes: number;
  topProcesses: string[];
};

/**
 * The rows arrive per day per destination per route; the question the block
 * answers is "where did this person's traffic go this week", so they are
 * folded on destination × route before anything is rendered. Folding on
 * destination alone would hide the one column that makes the direct-route
 * button meaningful — a domestic site currently going out through a paid exit.
 */
function merge(rows: readonly DestinationRowDto[]): Merged[] {
  const byKey = new Map<string, Merged>();
  for (const row of rows) {
    const id = `${row.etld1}|${row.route}`;
    const found = byKey.get(id);
    if (found) {
      found.connections += row.connections;
      found.bytes += row.bytesUp + row.bytesDown;
      for (const process of row.topProcesses) {
        if (!found.topProcesses.includes(process)) found.topProcesses.push(process);
      }
      continue;
    }
    byKey.set(id, {
      id,
      etld1: row.etld1,
      route: row.route,
      node: row.node,
      connections: row.connections,
      bytes: row.bytesUp + row.bytesDown,
      topProcesses: [...row.topProcesses],
    });
  }
  return [...byKey.values()].sort((a, b) => b.bytes - a.bytes);
}

export function Destinations({
  rows,
  state,
  message,
}: {
  rows: readonly DestinationRowDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
}) {
  const merged = useMemo(() => merge(rows), [rows]);
  const columns = useMemo(() => destinationColumns(), []);
  const tableState: TableState = state === 'ready'
    ? (merged.length === 0 ? 'empty' : 'ready')
    : state;

  return (
    <Section
      title={copy.customerSections.destinations}
      aside={<span className="text-micro text-[var(--muted-foreground)]">{copy.timelineFilters.week}</span>}
    >
      <DataTable
        rows={merged}
        columns={columns}
        getRowId={(row) => row.id}
        state={tableState}
        errorMessage={message}
      />
    </Section>
  );
}

function destinationColumns(): DataColumn<Merged>[] {
  return [
    {
      id: 'site',
      header: copy.destinationColumns.site,
      sortValue: (row) => row.etld1,
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-mono text-body">{row.etld1}</span>
          {row.topProcesses.length === 0 ? null : (
            <span className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {row.topProcesses.join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'route',
      header: copy.destinationColumns.route,
      width: '80px',
      sortValue: (row) => row.route,
      cell: (row) => <span className="ops-tag">{copy.route[row.route]}</span>,
    },
    {
      id: 'node',
      header: copy.destinationColumns.node,
      width: '150px',
      sortValue: (row) => row.node ?? '',
      cell: (row) => <Value value={row.node} source={copy.sourceWord.collector} />,
    },
    {
      id: 'connections',
      header: copy.destinationColumns.connections,
      width: '80px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.connections,
      cell: (row) => formatCount(row.connections),
    },
    {
      id: 'bytes',
      header: copy.destinationColumns.bytes,
      width: '100px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.bytes,
      cell: (row) => <BytesCell bytes={row.bytes} />,
    },
    {
      id: 'mark',
      header: copy.destinationColumns.action,
      width: '116px',
      align: 'right',
      cell: () => <Action reason={copy.markDirectBlocked}>{copy.markDirect}</Action>,
    },
  ];
}

function BytesCell({ bytes }: { bytes: number }) {
  const split = splitBytes(bytes);
  return (
    <span>
      {split.number}
      <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
        {split.unit}
      </span>
    </span>
  );
}
