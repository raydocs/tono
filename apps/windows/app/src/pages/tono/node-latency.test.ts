import { describe, expect, it } from 'vitest'

import { latencyLabelKey } from './node-latency'

describe('latencyLabelKey', () => {
  it('keeps TCP and exit as separate copy, and does not call 800ms a dead node', () => {
    expect(latencyLabelKey('tcp', 42)).toBe('tono.nodes.tcpLatency')
    expect(latencyLabelKey('exit', 80)).toBe('tono.nodes.exitLatency')
    expect(latencyLabelKey('exit', 816)).toBe('tono.nodes.exitLatencySlow')
    expect(latencyLabelKey('tcp', 500)).toBe('tono.nodes.tcpLatencySlow')
  })
})
