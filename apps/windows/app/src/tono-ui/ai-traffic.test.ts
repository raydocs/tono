import { describe, expect, it } from 'vitest'

import { accumulateAiTraffic } from './ai-traffic'

const connection = (
  id: string,
  process: string,
  chains: string[],
  upload: number,
  download: number,
) => ({
  id,
  chains,
  rule: 'DOMAIN-SUFFIX',
  upload,
  download,
  metadata: {
    network: 'tcp',
    type: 'Tun',
    host: 'api.example.test',
    sourceIP: '',
    sourcePort: '',
    destinationPort: '443',
    process,
  },
})

describe('AI traffic tally', () => {
  it('counts only home-routed AI apps, and each byte once', () => {
    const seen = new Map<string, number>()
    const home = ['HomeNode', 'Tono-Claude-Home']
    const frame = [
      connection('a', 'Claude.exe', home, 1_000, 9_000),
      connection('b', 'ChatGPT.exe', ['Tokyo', 'Tono-Exit'], 5_000, 5_000),
      connection('c', 'chrome.exe', home, 7_000, 7_000),
    ]
    const first = accumulateAiTraffic({}, seen, frame, '2026-09-30')
    const replay = accumulateAiTraffic(first, seen, frame, '2026-09-30')
    const grown = accumulateAiTraffic(
      replay,
      seen,
      [connection('a', 'Claude.exe', home, 2_000, 10_000)],
      '2026-09-30',
    )

    expect(first).toEqual({ '2026-09-30': { Claude: 10_000 } })
    expect(replay).toBe(first)
    expect(grown).toEqual({ '2026-09-30': { Claude: 12_000 } })
  })

  it('bounds completed receipts while preserving current-frame and remount dedup', () => {
    const seen = new Map<string, number>()
    const home = ['HomeNode', 'Tono-Claude-Home']
    const active = Array.from({ length: 2_000 }, (_, index) =>
      connection(`active-${index}`, 'Claude.exe', home, 100, 200),
    )
    let days = {}
    let frame = active
    for (let batch = 0; batch < 12; batch++) {
      const closed = Array.from({ length: 500 }, (_, index) =>
        connection(`closed-${batch * 500 + index}`, 'Claude.exe', home, 10, 20),
      )
      // Put newly observed flows first to catch eviction during iteration:
      // every still-active receipt must survive until it is touched.
      frame = [...closed, ...active]
      days = accumulateAiTraffic(
        days,
        seen,
        frame,
        '2026-09-30',
      )
    }
    expect(seen.size).toBeLessThanOrEqual(2_500)
    expect(days).toEqual({ '2026-09-30': { Claude: 780_000 } })
    expect(seen.size).toBe(2_500)
    expect(accumulateAiTraffic(days, seen, frame, '2026-09-30')).toBe(days)
    // The monitor's initial empty snapshot after remount is not evidence
    // that the retained flows have never been counted.
    expect(accumulateAiTraffic(days, seen, [], '2026-09-30')).toBe(days)
    expect(accumulateAiTraffic(days, seen, frame, '2026-09-30')).toBe(days)
  })
})
