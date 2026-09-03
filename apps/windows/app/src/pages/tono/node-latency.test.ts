import { describe, expect, it } from 'vitest'

import { TONO_COLORS } from '@/tono-ui/theme'

import {
  formatLatencySeconds,
  latencyColor,
  latencyLabelKey,
} from './node-latency'

describe('formatLatencySeconds', () => {
  it('speaks page-open time in seconds, not a debug millisecond stamp', () => {
    expect(formatLatencySeconds(320)).toBe('0.3')
    expect(formatLatencySeconds(816)).toBe('0.8')
    expect(formatLatencySeconds(1600)).toBe('1.6')
  })
})

describe('latencyLabelKey', () => {
  it('keeps TCP and exit as separate copy, and does not call a healthy Japan handshake slow', () => {
    expect(latencyLabelKey('tcp', 42)).toBe('tono.nodes.tcpLatency')
    expect(latencyLabelKey('exit', 80)).toBe('tono.nodes.exitLatency')
    expect(latencyLabelKey('exit', 816)).toBe('tono.nodes.exitLatency')
    expect(latencyLabelKey('exit', 920)).toBe('tono.nodes.exitLatency')
    expect(latencyLabelKey('exit', 1600)).toBe('tono.nodes.exitLatencySlow')
    expect(latencyLabelKey('tcp', 500)).toBe('tono.nodes.tcpLatencySlow')
  })
})

describe('latencyColor', () => {
  it('does not paint a 700–920ms Reality exit as dead', () => {
    expect(latencyColor(816, 'exit')).toBe(TONO_COLORS.latencyGood)
    expect(latencyColor(920, 'exit')).toBe(TONO_COLORS.latencyGood)
    expect(latencyColor(500, 'exit')).toBe(TONO_COLORS.latencyGood)
    expect(latencyColor(1200, 'exit')).toBe(TONO_COLORS.protectedOffline)
    expect(latencyColor(1600, 'exit')).toBe(TONO_COLORS.error)
    expect(latencyColor(500, 'tcp')).toBe(TONO_COLORS.error)
    expect(latencyColor(300, 'tcp')).toBe(TONO_COLORS.protectedOffline)
  })
})
