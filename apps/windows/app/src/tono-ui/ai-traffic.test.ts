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
})
