import { describe, expect, it } from 'vitest'

import zhTono from './zh/tono.json'

describe('zh restore action name', () => {
  it('uses 恢复正常网络 for every button and every prompt that names it', () => {
    const strings: string[] = []
    const walk = (value: unknown) => {
      if (typeof value === 'string') strings.push(value)
      else if (value && typeof value === 'object')
        Object.values(value).forEach(walk)
    }
    walk(zhTono)

    expect(zhTono.login.restoreInternet).toBe('恢复正常网络')
    expect(zhTono.login.networkBlocked.restore).toBe('恢复正常网络')
    expect(zhTono.progress.restore).toBe('恢复正常网络')
    expect(
      strings.filter((text) => /「恢复(网络|联网|上网)」/.test(text)),
    ).toEqual([])
  })
})
