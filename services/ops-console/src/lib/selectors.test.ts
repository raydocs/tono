import { describe, expect, it } from 'vitest';
import fleetRaw from '../../fixtures/fleet-nodes.json';
import { copy } from '@/copy/copy';
import { materializeFleet } from './fixture-load';
import { countLine, NODE_FILTERS, selectNodes } from './selectors';
import type { FleetFixtureFile } from './types';

const fleet = materializeFleet(fleetRaw as unknown as FleetFixtureFile);

describe('node selectors', () => {
  it('uses the same function for counts and filters', () => {
    const counts = countLine(fleet.nodes);
    for (const filter of NODE_FILTERS) {
      expect(counts[filter], filter).toBe(selectNodes(fleet.nodes, filter).length);
    }
  });

  it('counts exactly the filters the page offers', () => {
    expect(Object.keys(countLine(fleet.nodes)).sort()).toEqual([...NODE_FILTERS].sort());
    for (const filter of NODE_FILTERS) {
      expect(copy.count[filter], filter).toBeTypeOf('function');
    }
  });

  it('every filter narrows the list, and no filter returns it whole', () => {
    for (const filter of NODE_FILTERS) {
      const filtered = selectNodes(fleet.nodes, filter);
      expect(filtered.length, filter).toBeGreaterThan(0);
      expect(filtered.length, filter).toBeLessThan(fleet.nodes.length);
    }
    expect(selectNodes(fleet.nodes, null).length).toBe(fleet.nodes.length);
  });

  it('listed filter is catalogListed === true', () => {
    const listed = selectNodes(fleet.nodes, 'listed');
    expect(listed.every((node) => node.catalogListed === true)).toBe(true);
    expect(listed.length).toBeGreaterThan(0);
  });
});
