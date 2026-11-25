import { fields, int, num, oneOf, text, textList, violation } from './checkers';
import { ROUTE_KINDS, type RouteKind } from './vocabulary';

export interface FleetDestinationDto {
  etld1: string;
  route: RouteKind;
  users: number;
  connections: number;
  closedConnections: number;
  stalledConnections: number;
  stallRate: number;
  avgDurationMs: number;
  bytesUp: number;
  bytesDown: number;
  topProcesses: string[];
  nodes: string[];
}

const FLEET_DESTINATION_KEYS = [
  'etld1',
  'route',
  'users',
  'connections',
  'closedConnections',
  'stalledConnections',
  'stallRate',
  'avgDurationMs',
  'bytesUp',
  'bytesDown',
  'topProcesses',
  'nodes',
];

export function assertFleetDestination(
  value: unknown,
  path = 'fleetDestination',
): FleetDestinationDto {
  const row = fields(value, path, FLEET_DESTINATION_KEYS);
  const stallRate = num(row, path, 'stallRate');
  if (stallRate < 0 || stallRate > 1) violation(`${path}.stallRate`);
  return {
    etld1: text(row, path, 'etld1'),
    route: oneOf<RouteKind>(row, path, 'route', ROUTE_KINDS),
    users: int(row, path, 'users'),
    connections: int(row, path, 'connections'),
    closedConnections: int(row, path, 'closedConnections'),
    stalledConnections: int(row, path, 'stalledConnections'),
    stallRate,
    avgDurationMs: int(row, path, 'avgDurationMs'),
    bytesUp: int(row, path, 'bytesUp'),
    bytesDown: int(row, path, 'bytesDown'),
    topProcesses: textList(row, path, 'topProcesses'),
    nodes: textList(row, path, 'nodes'),
  };
}
