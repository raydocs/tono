import { describe, expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { mapFleetHealth } from './health';

describe('mapFleetHealth', () => {
  it('maps DOWN and EDGE_FAIL to 失联', () => {
    expect(mapFleetHealth({ qualityStatus: 'DOWN', agentStatus: 'online' })).toBe(copy.health.lost);
    expect(mapFleetHealth({ qualityStatus: 'EDGE_FAIL', agentStatus: 'online' })).toBe(copy.health.lost);
  });

  it('maps LIKELY_BLOCKED to 被墙', () => {
    expect(mapFleetHealth({ qualityStatus: 'LIKELY_BLOCKED', agentStatus: 'online' })).toBe(copy.health.blocked);
  });

  it('maps DEGRADED and stale agent to 劣化', () => {
    expect(mapFleetHealth({ qualityStatus: 'DEGRADED', agentStatus: 'online' })).toBe(copy.health.degraded);
    expect(mapFleetHealth({ qualityStatus: 'OK', agentStatus: 'stale' })).toBe(copy.health.degraded);
  });

  it('maps OK plus online agent to 正常', () => {
    expect(mapFleetHealth({ qualityStatus: 'OK', agentStatus: 'online' })).toBe(copy.health.ok);
    expect(mapFleetHealth({ qualityStatus: 'EDGE_OK', agentStatus: 'online' })).toBe(copy.health.ok);
  });

  it('maps unknown or unprobed to 未测', () => {
    expect(mapFleetHealth({ qualityStatus: 'UNKNOWN', agentStatus: 'missing' })).toBe(copy.health.unmeasured);
    expect(mapFleetHealth({ qualityStatus: 'UNPROBED', agentStatus: 'online' })).toBe(copy.health.unmeasured);
    expect(mapFleetHealth({ qualityStatus: 'OK', agentStatus: 'missing' })).toBe(copy.health.unmeasured);
  });

  it('applies precedence 失联 > 被墙 > 劣化 > 正常 > 未测', () => {
    expect(mapFleetHealth({ qualityStatus: 'DOWN', agentStatus: 'stale' })).toBe(copy.health.lost);
    expect(mapFleetHealth({ qualityStatus: 'LIKELY_BLOCKED', agentStatus: 'stale' })).toBe(copy.health.blocked);
    expect(mapFleetHealth({ qualityStatus: 'DEGRADED', agentStatus: 'online' })).toBe(copy.health.degraded);
  });
});
