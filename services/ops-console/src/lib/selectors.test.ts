import { describe, expect, it } from 'vitest';
import fleetRaw from '../../fixtures/fleet-nodes.json';
import { materializeFleet } from './fixture-load';
import { countLine, selectNodes } from './selectors';
import type { FleetFixtureFile } from './types';

const fleet = materializeFleet(fleetRaw as unknown as FleetFixtureFile);

describe('node selectors', () => {
  it('uses the same function for counts and filters', () => {
    const counts = countLine(fleet.nodes);
    const filters = ['listed', 'blocked', 'unmeasured'] as const;
    for (const filter of filters) {
      const filtered = selectNodes(fleet.nodes, filter);
      expect(counts[filter]).toBe(filtered.length);
    }
  });

  it('listed filter is catalogListed === true', () => {
    const listed = selectNodes(fleet.nodes, 'listed');
    expect(listed.every((node) => node.catalogListed === true)).toBe(true);
    expect(listed.length).toBeGreaterThan(0);
  });
});
