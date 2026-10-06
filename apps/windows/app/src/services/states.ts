import { createContextState } from 'foxact/create-context-state'

import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'

const [ThemeModeProvider, useStoredThemeMode, useSetThemeMode] =
  createContextState<'light' | 'dark'>()

const useThemeMode = () => {
  const storedMode = useStoredThemeMode()
  const { newAppearance } = useAppearancePreferences()
  return newAppearance ? 'dark' : storedMode
}

// save the state of each profile item loading
const [LoadingCacheProvider, useLoadingCache, useSetLoadingCache] =
  createContextState<Set<string>>(new Set())

// save update state
const [UpdateStateProvider, useUpdateState, useSetUpdateState] =
  createContextState<boolean>(false)

export {
  ThemeModeProvider,
  useThemeMode,
  useSetThemeMode,
  LoadingCacheProvider,
  useLoadingCache,
  useSetLoadingCache,
  UpdateStateProvider,
  useUpdateState,
  useSetUpdateState,
}
