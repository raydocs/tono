import { getTonoPreferences } from './cmds'
import {
  cacheLanguage,
  getCachedLanguage,
  initializeLanguage,
  resolveLanguage,
} from './i18n'

let preferencesCache: TonoPreferences | null | undefined

const detectSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const getThemeModeFromWindow = ():
  | TonoPreferences['theme_mode']
  | undefined => {
  if (typeof window === 'undefined') return undefined
  const mode =
    (
      window as typeof window & {
        __TONO_INITIAL_THEME_MODE?: unknown
        __VERGE_INITIAL_THEME_MODE?: unknown
      }
    ).__TONO_INITIAL_THEME_MODE ??
    (
      window as typeof window & {
        __VERGE_INITIAL_THEME_MODE?: unknown
      }
    ).__VERGE_INITIAL_THEME_MODE
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    return mode
  }
  return undefined
}

export const resolveThemeMode = (
  preferences?: TonoPreferences | null,
): 'light' | 'dark' => {
  const initialMode = preferences?.theme_mode ?? getThemeModeFromWindow()
  if (initialMode === 'dark' || initialMode === 'light') {
    return initialMode
  }
  return detectSystemTheme()
}

export const setPreloadConfig = (config: TonoPreferences | null) => {
  preferencesCache = config
}

export const getPreloadConfig = () => preferencesCache

const preloadConfig = async () => {
  try {
    const config = await getTonoPreferences()
    setPreloadConfig(config)
    return config
  } catch (error) {
    console.warn('[preload.ts] Failed to read Tono preferences:', error)
    setPreloadConfig(null)
    return null
  }
}

const preloadLanguage = async (
  preferences?: TonoPreferences | null,
  loadConfig: () => Promise<TonoPreferences | null> = preloadConfig,
) => {
  const cachedLanguage = getCachedLanguage()
  if (cachedLanguage) {
    return cachedLanguage
  }

  let resolvedConfig = preferences

  if (resolvedConfig === undefined) {
    try {
      resolvedConfig = await loadConfig()
    } catch (error) {
      console.warn(
        '[preload.ts] Failed to read language from Tono preferences:',
        error,
      )
      resolvedConfig = null
    }
  }

  const languageFromConfig = resolvedConfig?.language
  if (languageFromConfig) {
    const resolved = resolveLanguage(languageFromConfig)
    cacheLanguage(resolved)
    return resolved
  }

  const browserLanguage = resolveLanguage(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
  )
  cacheLanguage(browserLanguage)
  return browserLanguage
}

export const preloadAppData = async () => {
  const configPromise = preloadConfig()
  const initialLanguage = await preloadLanguage(undefined, () => configPromise)
  const [config] = await Promise.all([
    configPromise,
    initializeLanguage(initialLanguage),
  ])
  const initialThemeMode = resolveThemeMode(config)
  return { initialThemeMode, initialLanguage }
}
