import { createContextState } from 'foxact/create-context-state'
import { useSyncExternalStore } from 'react'

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

// Shared download progress percentage (0-100) while a package is downloading,
// or null when idle / content length is unknown.
let currentUpdateProgress: number | null = null
const updateProgressListeners = new Set<() => void>()

const subscribeUpdateProgress = (listener: () => void) => {
  updateProgressListeners.add(listener)
  return () => updateProgressListeners.delete(listener)
}

const getUpdateProgress = () => currentUpdateProgress

const setUpdateProgress = (next: number | null) => {
  const normalized =
    next === null ? null : Math.min(100, Math.max(0, Math.round(next)))
  if (currentUpdateProgress === normalized) return
  currentUpdateProgress = normalized
  for (const listener of updateProgressListeners) listener()
}

const useUpdateProgress = () =>
  useSyncExternalStore(subscribeUpdateProgress, getUpdateProgress, () => null)

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
  useUpdateProgress,
  setUpdateProgress,
}
