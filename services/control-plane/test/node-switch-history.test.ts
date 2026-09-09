import { describe, expect, it } from 'vitest';
import { NODE_SWITCH_FREQUENT_24H, nodeSwitchHistory } from '../src/node-switch-history';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function windowWith(events: unknown[], deviceId = 'dev-1') {
  return {
    device_id: deviceId,
    payload_json: JSON.stringify({
      schemaVersion: 1,
      kind: 'periodic_window',
      events,
    }),
  };
}

describe('nodeSwitchHistory', () => {
  const nowMs = 1_800_000_000_000;

  it('extracts user node switches newest first', () => {
    const history = nodeSwitchHistory([
      windowWith([
        { ts: nowMs - 2 * HOUR, kind: 'nodeSwitch', from: 'Tokyo · Fuji', to: 'Los Angeles · Pacific' },
        { ts: nowMs - HOUR, kind: 'connectOk', node: 'Los Angeles · Pacific' },
        { ts: nowMs - 30 * 60_000, kind: 'nodeSwitch', from: 'Los Angeles · Pacific', to: 'Tokyo · Sakura' },
      ]),
    ], nowMs);

    expect(history.hops).toEqual([
      {
        ts: nowMs - 30 * 60_000,
        from: 'Los Angeles · Pacific',
        to: 'Tokyo · Sakura',
        kind: 'nodeSwitch',
        deviceId: 'dev-1',
      },
      {
        ts: nowMs - 2 * HOUR,
        from: 'Tokyo · Fuji',
        to: 'Los Angeles · Pacific',
        kind: 'nodeSwitch',
        deviceId: 'dev-1',
      },
    ]);
    expect(history.last24h).toBe(2);
    expect(history.last7d).toBe(2);
    expect(history.uniqueNodes).toBe(3);
    expect(history.frequent).toBe(false);
  });

  it('drops the same hop when overlapping telemetry windows replay it', () => {
    const hop = { ts: nowMs - HOUR, kind: 'nodeSwitch', from: 'A', to: 'B' };
    const history = nodeSwitchHistory([
      windowWith([hop], 'dev-1'),
      windowWith([hop], 'dev-1'),
    ], nowMs);

    expect(history.hops).toHaveLength(1);
    expect(history.last24h).toBe(1);
  });

  it('counts catalog failover as an IP hop for 风控', () => {
    const history = nodeSwitchHistory([
      windowWith([
        { ts: nowMs - HOUR, kind: 'connectCatalogFailover', from: 'Tokyo · Fuji', to: 'Tokyo · Sakura' },
      ]),
    ], nowMs);

    expect(history.hops[0]).toMatchObject({
      kind: 'connectCatalogFailover',
      from: 'Tokyo · Fuji',
      to: 'Tokyo · Sakura',
    });
    expect(history.last24h).toBe(1);
  });

  it('flags frequent hopping once 24h hops reach the 风控 threshold', () => {
    const events = Array.from({ length: NODE_SWITCH_FREQUENT_24H }, (_, index) => ({
      ts: nowMs - (index + 1) * HOUR,
      kind: 'nodeSwitch',
      from: `City ${index}`,
      to: `City ${index + 1}`,
    }));
    const history = nodeSwitchHistory([windowWith(events)], nowMs);

    expect(history.last24h).toBe(NODE_SWITCH_FREQUENT_24H);
    expect(history.frequent).toBe(true);
  });

  it('does not treat a 7-day hop as a 24-hour hop', () => {
    const history = nodeSwitchHistory([
      windowWith([
        { ts: nowMs - 2 * DAY, kind: 'nodeSwitch', from: 'Tokyo · Fuji', to: 'Los Angeles · Pacific' },
      ]),
    ], nowMs);

    expect(history.last24h).toBe(0);
    expect(history.last7d).toBe(1);
    expect(history.frequent).toBe(false);
  });

  it('keeps 24h counts after the displayed hop list is capped', () => {
    const events = Array.from({ length: 60 }, (_, index) => ({
      ts: nowMs - index * 60_000,
      kind: 'nodeSwitch',
      from: `N${index}`,
      to: `N${index + 1}`,
    }));
    const history = nodeSwitchHistory([windowWith(events)], nowMs);

    expect(history.hops).toHaveLength(50);
    expect(history.last24h).toBe(60);
    expect(history.frequent).toBe(true);
  });

  it('skips malformed windows instead of throwing', () => {
    const history = nodeSwitchHistory([
      { device_id: 'dev-1', payload_json: '{not-json' },
      { device_id: 'dev-1', payload_json: JSON.stringify({ events: 'nope' }) },
    ], nowMs);

    expect(history).toEqual({
      hops: [],
      last24h: 0,
      last7d: 0,
      uniqueNodes: 0,
      frequent: false,
    });
  });
});
