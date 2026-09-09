import { useMemo } from 'react';
import type { RouteKind, ServiceFamily, ServiceUsageDto } from '@contract';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatWhenAgo, splitBytes } from '@/lib/display';

type Family = {
  family: ServiceFamily;
  routes: RouteKind[];
  bytes: number;
  lastSeenAt: number | null;
};

/**
 * One row per family, not per family per day: 服务使用 answers "what are they
 * using and which way does it go", and a Claude row split over six days is
 * six answers to a question with one.
 */
function fold(rows: readonly ServiceUsageDto[]): Family[] {
  const byFamily = new Map<ServiceFamily, Family>();
  for (const row of rows) {
    let found = byFamily.get(row.family);
    if (!found) {
      found = { family: row.family, routes: [], bytes: 0, lastSeenAt: null };
      byFamily.set(row.family, found);
    }
    found.bytes += row.bytes;
    if (!found.routes.includes(row.route)) found.routes.push(row.route);
    if (row.lastSeenAt !== null && (found.lastSeenAt === null || row.lastSeenAt > found.lastSeenAt)) {
      found.lastSeenAt = row.lastSeenAt;
    }
  }
  return [...byFamily.values()].sort((a, b) => b.bytes - a.bytes);
}

export function ServiceUsage({
  rows,
  state,
  message,
}: {
  rows: readonly ServiceUsageDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
}) {
  const families = useMemo(() => fold(rows), [rows]);
  const columns = useMemo(() => serviceColumns(), []);
  const tableState: TableState = state === 'ready'
    ? (families.length === 0 ? 'empty' : 'ready')
    : state;

  return (
    <Section
      title={copy.customerSections.services}
      aside={<span className="text-micro text-[var(--muted-foreground)]">{copy.timelineFilters.week}</span>}
    >
      <DataTable
        rows={families}
        columns={columns}
        getRowId={(row) => row.family}
        state={tableState}
        errorMessage={message}
      />
    </Section>
  );
}

function serviceColumns(): DataColumn<Family>[] {
  return [
    {
      id: 'family',
      header: copy.serviceColumns.family,
      sortValue: (row) => row.family,
      cell: (row) => <span className="text-row">{copy.serviceName[row.family]}</span>,
    },
    {
      id: 'route',
      header: copy.serviceColumns.route,
      width: '160px',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.routes.map((route) => (
            <span key={route} className="ops-tag">{copy.route[route]}</span>
          ))}
        </span>
      ),
    },
    {
      id: 'bytes',
      header: copy.serviceColumns.bytes,
      width: '110px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.bytes,
      cell: (row) => {
        const split = splitBytes(row.bytes);
        return (
          <span>
            {split.number}
            <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              {split.unit}
            </span>
          </span>
        );
      },
    },
    {
      id: 'lastSeen',
      header: copy.serviceColumns.lastSeen,
      width: '120px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.lastSeenAt ?? 0,
      cell: (row) => (
        <Value
          value={row.lastSeenAt === null ? null : formatWhenAgo(row.lastSeenAt)}
          source={copy.sourceWord.collector}
          mono
        />
      ),
    },
  ];
}
