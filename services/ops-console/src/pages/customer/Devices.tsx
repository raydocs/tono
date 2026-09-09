import { useMemo } from 'react';
import type { CustomerDeviceDto, Platform } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatWhenAgo } from '@/lib/display';

/**
 * Which platforms have a device action at all.
 *
 * Empty today: 发起远程诊断 and friends need write endpoints nobody has wired
 * yet, so every button on every row is disabled with its own reason. When the
 * first platform gets one, it goes in here and only that platform's buttons
 * come alive — which is the point of keeping the capability on the platform
 * rather than on the button.
 */
const PLATFORMS_WITH_ACTIONS: Platform[] = [];

export function Devices({ devices }: { devices: readonly CustomerDeviceDto[] }) {
  const columns = useMemo(() => deviceColumns(), []);
  return (
    <Section title={copy.customerSections.devices}>
      <DataTable
        rows={[...devices]}
        columns={columns}
        getRowId={(row) => row.id}
        state={devices.length === 0 ? 'empty' : 'ready'}
      />
    </Section>
  );
}

function deviceColumns(): DataColumn<CustomerDeviceDto>[] {
  return [
    {
      id: 'name',
      header: copy.deviceColumns.name,
      sortValue: (row) => row.name,
      cell: (row) => <span className="truncate text-row">{row.name}</span>,
    },
    {
      id: 'platform',
      header: copy.deviceColumns.platform,
      width: '90px',
      sortValue: (row) => row.platform ?? '',
      cell: (row) => (
        row.platform === null
          ? <Value value={null} source={copy.sourceWord.telemetry} />
          : <span className="ops-tag">{copy.platform[row.platform]}</span>
      ),
    },
    {
      id: 'version',
      header: copy.deviceColumns.version,
      width: '84px',
      mono: true,
      sortValue: (row) => row.appVersion ?? '',
      cell: (row) => <Value value={row.appVersion} source={copy.sourceWord.telemetry} mono />,
    },
    {
      id: 'os',
      header: copy.deviceColumns.os,
      width: '150px',
      sortValue: (row) => row.osVersion ?? '',
      cell: (row) => <Value value={row.osVersion} source={copy.sourceWord.telemetry} />,
    },
    {
      id: 'lastSeen',
      header: copy.deviceColumns.lastSeen,
      width: '104px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.lastSeenAt ?? 0,
      cell: (row) => (
        <Value
          value={row.lastSeenAt === null ? null : formatWhenAgo(row.lastSeenAt)}
          source={copy.sourceWord.telemetry}
          mono
        />
      ),
    },
    {
      id: 'node',
      header: copy.deviceColumns.node,
      width: '140px',
      sortValue: (row) => row.selectedServer ?? '',
      cell: (row) => <Value value={row.selectedServer} source={copy.sourceWord.catalog} />,
    },
    {
      id: 'action',
      header: copy.deviceColumns.action,
      width: '130px',
      align: 'right',
      cell: (row) => {
        const platform = row.platform;
        const supported = platform !== null && PLATFORMS_WITH_ACTIONS.includes(platform);
        const reason = supported
          ? copy.customerActions.blocked
          : copy.deviceActionBlocked(platform === null ? copy.missing : copy.platform[platform]);
        return <Action reason={reason}>{copy.customerActions.diagnose}</Action>;
      },
    },
  ];
}
