import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { FleetDestinationDto } from '@contract';
import { FleetDestinationsTable } from './FleetDestinations';

it('renders fleet destinations with stall rate, average duration and route tags', () => {
  const rows: FleetDestinationDto[] = [
    {
      etld1: 'todesk.com',
      route: 'direct',
      users: 4,
      connections: 18,
      closedConnections: 16,
      stalledConnections: 4,
      stallRate: 0.25,
      avgDurationMs: 3200,
      bytesUp: 1200,
      bytesDown: 2896,
      topProcesses: ['ToDesk'],
      nodes: ['HK-01'],
    },
    {
      etld1: 'gitee.com',
      route: 'cloud',
      users: 6,
      connections: 42,
      closedConnections: 0,
      stalledConnections: 0,
      stallRate: 0,
      avgDurationMs: 0,
      bytesUp: 0,
      bytesDown: 8192,
      topProcesses: ['Chrome'],
      nodes: [],
    },
  ];
  const html = renderToString(<FleetDestinationsTable rows={rows} />);
  expect(html).toContain('todesk.com');
  expect(html).toContain('4 (25.0%)');
  expect(html).toContain('3200 ms');
  expect(html).toContain('gitee.com');
  expect(html).toContain('—');
});
