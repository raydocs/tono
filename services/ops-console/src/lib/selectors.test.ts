import { describe, expect, it } from 'vitest';
import { assertList, assertNodeSummary, NODE_HEALTH_WORDS } from '@contract';
import nodesRaw from '../../fixtures/nodes.json';
import { copy } from '@/copy/copy';
import {
  countLine,
  lifecycleCounts,
  NODE_FILTERS,
  NODE_LIFECYCLE_CHIPS,
  nodeWord,
  selectLifecycle,
  selectNodes,
} from './selectors';

const nodes = assertList(nodesRaw.list, assertNodeSummary, 'nodes').items;

describe('node selectors', () => {
  it('uses the same function for counts and filters', () => {
    const counts = countLine(nodes);
    for (const filter of NODE_FILTERS) {
      expect(counts[filter], filter).toBe(selectNodes(nodes, filter).length);
    }
  });

  it('counts exactly the filters the page offers', () => {
    expect(Object.keys(countLine(nodes)).sort()).toEqual([...NODE_FILTERS].sort());
  });

  it('names the five health words, in the engine order', () => {
    expect(NODE_FILTERS.map(nodeWord)).toEqual([...NODE_HEALTH_WORDS]);
  });

  it('partitions the fleet: every machine falls under exactly one fragment', () => {
    const counts = countLine(nodes);
    const summed = NODE_FILTERS.reduce((total, id) => total + counts[id], 0);
    expect(summed).toBe(nodes.length);
  });

  it('reads the word the engine wrote rather than judging again', () => {
    for (const filter of NODE_FILTERS) {
      for (const node of selectNodes(nodes, filter)) {
        expect(node.health, node.name).toBe(nodeWord(filter));
      }
    }
  });
});

describe('the lifecycle axis', () => {
  it('hides retired machines until a chip asks for them', () => {
    const shown = selectLifecycle(nodes, null);
    expect(shown.every((node) => node.lifecycle !== 'retired')).toBe(true);
    expect(shown.length).toBeLessThan(nodes.length);

    const retired = selectLifecycle(nodes, 'retired');
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((node) => node.lifecycle === 'retired')).toBe(true);
  });

  it('counts every lifecycle over the whole fleet, hidden or not', () => {
    const counts = lifecycleCounts(nodes);
    const summed = NODE_LIFECYCLE_CHIPS.reduce((total, id) => total + counts[id], 0);
    expect(summed).toBe(nodes.length);
    expect(counts.retired).toBeGreaterThan(0);
  });

  /**
   * The bug this page was rebuilt for: a machine taken out of service answers
   * no probe, so the old page called it 失联 and counted it, while 今天 had
   * already stopped raising incidents for it.
   */
  it('keeps a retired machine out of the count sentence the operator reads', () => {
    const retired = nodes.filter((node) => node.lifecycle === 'retired');
    expect(retired.some((node) => node.health === copy.health.lost)).toBe(true);
    const counts = countLine(selectLifecycle(nodes, null));
    const lostOnShow = selectNodes(selectLifecycle(nodes, null), 'lost');
    expect(counts.lost).toBe(lostOnShow.length);
    expect(lostOnShow.every((node) => node.lifecycle !== 'retired')).toBe(true);
  });
});
