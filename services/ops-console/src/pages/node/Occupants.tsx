import { useMemo } from 'react';
import type { Measured, NodeOccupantDto } from '@contract';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatWhenAgo } from '@/lib/display';
import { openCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { sourceWord } from '@/lib/sources';

/**
 * Who is on the machine now: the people an unlisting or a restart would
 * interrupt, one click from their own page. It sits above the error and job
 * blocks on purpose: every destructive button on this page is about these rows.
 */
export function NodeOccupants({ occupancy }: { occupancy: Measured<NodeOccupantDto[]> }) {
  const privacy = usePrivacy();
  const source = sourceWord(occupancy.source);
  const columns = useMemo(
    () => occupantColumns(privacy.email, source),
    [privacy, source],
  );
  const rows = occupancy.value;

  return (
    <Section
      title={copy.nodeSections.occupancy}
      aside={
        <span className="text-micro text-[var(--muted-foreground)]">
          {occupancy.asOfSec === null ? source : formatWhenAgo(occupancy.asOfSec)}
        </span>
      }
    >
      {rows.length === 0 ? <Empty message={copy.nodeNoOccupants} /> : (
        <DataTable
          rows={[...rows]}
          columns={columns}
          getRowId={(row) => `${row.userId}/${row.deviceId ?? ''}`}
          onRowClick={(row) => openCustomer(row.userId)}
          state="ready"
          className="[&>table]:min-w-[680px]"
        />
      )}
    </Section>
  );
}

function occupantColumns(
  mask: (email: string) => string,
  source: string,
): DataColumn<NodeOccupantDto>[] {
  return [
    {
      id: 'customer',
      header: copy.nodeOccupantColumns.customer,
      sortValue: (row) => row.email,
      cell: (row) => <span className="truncate text-row">{mask(row.email)}</span>,
    },
    {
      id: 'device',
      header: copy.nodeOccupantColumns.device,
      width: '220px',
      sortValue: (row) => row.platform ?? '',
      cell: (row) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-mono text-body text-[var(--muted-foreground)]">
            {row.deviceId ?? copy.missing}
          </span>
          {row.platform === null ? null : (
            <span className="ops-tag shrink-0">{copy.platform[row.platform]}</span>
          )}
        </span>
      ),
    },
    {
      id: 'version',
      header: copy.nodeOccupantColumns.version,
      width: '90px',
      mono: true,
      sortValue: (row) => row.appVersion ?? '',
      cell: (row) => <Value value={row.appVersion} source={source} mono />,
    },
    {
      id: 'online',
      header: copy.nodeOccupantColumns.online,
      width: '72px',
      sortValue: (row) => (row.online ? 1 : 0),
      cell: (row) => (
        <span className={row.online ? 'text-row' : 'text-body text-[var(--muted-foreground)]'}>
          {row.online ? copy.nodeOnline : copy.nodeOffline}
        </span>
      ),
    },
    {
      id: 'lastSeen',
      header: copy.nodeOccupantColumns.lastSeen,
      width: '110px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.lastSeenAt,
      cell: (row) => <Value value={formatWhenAgo(row.lastSeenAt)} source={source} mono />,
    },
  ];
}
