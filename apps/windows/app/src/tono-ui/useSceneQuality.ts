import { useEffect, useRef } from 'react'

import {
  recordSceneProbe,
  useAppearancePreferences,
} from './appearance-preferences'
import { readSceneRenderer, SceneQualityProbe } from './scene-quality-probe'

// A second mounted decorative surface must not start a parallel device probe.
let probeOwner: object | null = null
export const useSceneQuality = (visibleAndAnimating: boolean) => {
  const preferences = useAppearancePreferences()
  const quality =
    preferences.motion === 'auto'
      ? preferences.automaticQuality
      : preferences.motion
  const ownerRef = useRef({})
  const retainedRef = useRef<{
    revision: number
    probe: SceneQualityProbe
  } | null>(null)
  const revision = preferences.revision
  const measured = preferences.measured

  useEffect(() => {
    if (!visibleAndAnimating || measured || quality === 'static' || probeOwner)
      return
    const identity = ownerRef.current
    probeOwner = identity
    if (retainedRef.current?.revision !== revision) {
      retainedRef.current = {
        revision,
        probe: new SceneQualityProbe(
          quality,
          preferences.motion === 'auto',
          readSceneRenderer(),
        ),
      }
    }
    const probe = retainedRef.current.probe
    if (probe.quality !== quality)
      recordSceneProbe(revision, probe.quality, probe.report(), false)
    let frameId = 0
    const sample = (now: number) => {
      const previous = probe.quality
      probe.frame(now)
      if (probe.complete || previous !== probe.quality)
        recordSceneProbe(
          revision,
          probe.quality,
          probe.report(),
          probe.complete,
        )
      if (!probe.complete) frameId = requestAnimationFrame(sample)
    }
    frameId = requestAnimationFrame(sample)
    return () => {
      cancelAnimationFrame(frameId)
      probe.pause()
      if (probeOwner === identity) probeOwner = null
    }
    // Retain the same visible budget across downgrades and visibility changes.
  }, [visibleAndAnimating, measured, revision, quality, preferences.motion])
  return { quality, preferences }
}
