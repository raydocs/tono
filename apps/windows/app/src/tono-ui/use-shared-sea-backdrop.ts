import { createContext, use, useLayoutEffect } from 'react'

import type { SeaPhase } from './SeaScene'

export interface Presentation {
  phase: SeaPhase
  progress?: number
  state?: string
}
export const BackdropContext = createContext<
  ((value: Presentation | null) => void) | null
>(null)

export const useSharedSeaBackdrop = (
  phase: SeaPhase,
  progress: number | undefined,
  state: string,
) => {
  const update = use(BackdropContext)
  useLayoutEffect(() => {
    update?.({ phase, progress, state })
  }, [update, phase, progress, state])
  // A home that is gone (route change, render error) must not keep painting its last phase.
  useLayoutEffect(() => () => update?.(null), [update])
  return update !== null
}
