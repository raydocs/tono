import { useSyncExternalStore } from 'react'

export type SceneQuality = 'full' | 'lite' | 'static'
export type MotionPreference = 'auto' | SceneQuality
export interface SceneProbeReport {
  fps: number
  p95: number
  liteP95: number | null
  renderer: string
  visibleMs: number
  samples: number
}
interface AppearancePreferences {
  newAppearance: boolean
  motion: MotionPreference
  automaticQuality: SceneQuality
  measured: boolean
  revision: number
  report: SceneProbeReport | null
}

const KEY = 'tono-ui-preferences'
const EVENT = 'tono-ui-preferences-changed'
const DEFAULT: AppearancePreferences = {
  newAppearance: false,
  motion: 'auto',
  automaticQuality: 'full',
  measured: false,
  revision: 0,
  report: null,
}
const modes: readonly MotionPreference[] = ['auto', 'full', 'lite', 'static']
export const isMotionPreference = (value: unknown): value is MotionPreference =>
  modes.some((mode) => mode === value)
const isQuality = (value: unknown): value is SceneQuality =>
  value === 'full' || value === 'lite' || value === 'static'
const rank = { full: 0, lite: 1, static: 2 }
let rawCache: string | null | undefined
let cache = DEFAULT
let unavailable = false

export const readAppearancePreferences = (): AppearancePreferences => {
  if (typeof window === 'undefined' || unavailable) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === rawCache) return cache
    rawCache = raw
    const value = raw ? JSON.parse(raw) : null
    cache = {
      ...DEFAULT,
      newAppearance: value?.newAppearance === true,
      motion: isMotionPreference(value?.motion) ? value.motion : 'auto',
      automaticQuality: isQuality(value?.automaticQuality)
        ? value.automaticQuality
        : 'full',
      measured: value?.measured === true,
      revision:
        Number.isSafeInteger(value?.revision) && value.revision >= 0
          ? value.revision
          : 0,
      report:
        value?.report &&
        Number.isFinite(value.report.fps) &&
        Number.isFinite(value.report.p95) &&
        typeof value.report.renderer === 'string' &&
        Number.isFinite(value.report.visibleMs) &&
        Number.isFinite(value.report.samples) &&
        (value.report.liteP95 === null || Number.isFinite(value.report.liteP95))
          ? value.report
          : null,
    }
  } catch {
    cache = DEFAULT
  }
  return cache
}
const write = (next: AppearancePreferences) => {
  cache = next
  rawCache = JSON.stringify(next)
  try {
    localStorage.setItem(KEY, rawCache)
  } catch {
    // A blocked local store still keeps one measurement for this window.
    unavailable = true
  }
  window.dispatchEvent(new Event(EVENT))
}
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) notify()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, notify)
    window.removeEventListener('storage', onStorage)
  }
}
export const useAppearancePreferences = () =>
  useSyncExternalStore(subscribe, readAppearancePreferences, () => DEFAULT)

/** Picking Auto again is the only way to reset its saved downgrade. */
export const setMotionPreference = (motion: MotionPreference) => {
  const current = readAppearancePreferences()
  write({
    ...current,
    motion,
    measured: false,
    report: null,
    revision: current.revision + 1,
    automaticQuality: motion === 'auto' ? 'full' : current.automaticQuality,
  })
}
export const recordSceneProbe = (
  revision: number,
  quality: SceneQuality,
  report: SceneProbeReport,
  complete: boolean,
) => {
  const current = readAppearancePreferences()
  if (current.revision !== revision || current.measured) return
  write({
    ...current,
    report,
    measured: complete,
    automaticQuality:
      current.motion === 'auto' &&
      rank[quality] > rank[current.automaticQuality]
        ? quality
        : current.automaticQuality,
  })
}
