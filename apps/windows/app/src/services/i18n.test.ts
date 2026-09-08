import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  FALLBACK_LANGUAGE,
  cacheLanguage,
  changeLanguage,
  getCachedLanguage,
  resolveLanguage,
  supportedLanguages,
} from './i18n'

describe('resolveLanguage', () => {
  test('keeps the product languages', () => {
    expect(supportedLanguages).toEqual(['en', 'zh'])
    expect(resolveLanguage('en')).toBe('en')
    expect(resolveLanguage('EN')).toBe('en')
    expect(resolveLanguage('zh')).toBe('zh')
  })

  test('maps Chinese region tags onto zh', () => {
    expect(resolveLanguage('zh-tw')).toBe('zh')
    expect(resolveLanguage('zh_TW')).toBe('zh')
    expect(resolveLanguage('zhtw')).toBe('zh')
    expect(resolveLanguage('zh-cn')).toBe('zh')
  })

  test('falls back leftover Clash Verge locales to zh', () => {
    for (const language of [
      'ar',
      'de',
      'es',
      'fa',
      'id',
      'jp',
      'ko',
      'ru',
      'tr',
      'tt',
    ]) {
      expect(resolveLanguage(language)).toBe(FALLBACK_LANGUAGE)
    }
  })

  test('uses the default for absent or empty language values', () => {
    expect(resolveLanguage(undefined)).toBe(FALLBACK_LANGUAGE)
    expect(resolveLanguage('')).toBe(FALLBACK_LANGUAGE)
  })
})

describe('language storage compatibility', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  test('reads an existing legacy preference without discarding English', () => {
    values.set('verge-language', 'en-US')
    expect(getCachedLanguage()).toBe('en')
    expect(values.get('verge-language')).toBe('en-US')
  })

  test('prefers the Tono setting when both cache keys exist', () => {
    values.set('tono-language', 'en')
    values.set('verge-language', 'zh')
    expect(getCachedLanguage()).toBe('en')
  })

  test('normalizes a retired locale and removes the legacy key only on write', () => {
    values.set('verge-language', 'de')
    expect(getCachedLanguage()).toBe(FALLBACK_LANGUAGE)
    cacheLanguage(getCachedLanguage()!)
    expect(values.get('tono-language')).toBe(FALLBACK_LANGUAGE)
    expect(values.has('verge-language')).toBe(false)
  })

  test('does not erase the legacy preference if saving the new key fails', () => {
    values.set('verge-language', 'en')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })
    expect(() => cacheLanguage('zh')).not.toThrow()
    expect(values.get('verge-language')).toBe('en')
    expect(values.has('tono-language')).toBe(false)
  })

  test('loads actual en/zh startup sections using the restricted glob', async () => {
    for (const language of ['en', 'zh']) {
      await changeLanguage(language)
      expect(i18n.language).toBe(language)
      for (const section of ['layout', 'shared', 'settings', 'tono']) {
        expect(i18n.getResource(language, 'translation', section)).toBeDefined()
      }
      expect(getCachedLanguage()).toBe(language)
    }
  })

  test('handles an unavailable browser storage API', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage access denied')
      },
    })
    expect(getCachedLanguage()).toBeUndefined()
    expect(() => cacheLanguage('en')).not.toThrow()
  })
})
