import { useState, type ReactNode } from 'react'

import { useTonoStatus } from '@/hooks/use-tono'

import { seaPresentation } from './sea-presentation'
import { SeaScene } from './SeaScene'
import { BackdropContext, type Presentation } from './use-shared-sea-backdrop'

/** Only scenery survives navigation; hidden pages keep no handlers or subscriptions. */
export const SeaBackdrop = ({
  enabled,
  active,
  children,
}: {
  enabled: boolean
  active: boolean
  children: ReactNode
}) => {
  const { status } = useTonoStatus()
  const [home, setHome] = useState<Presentation | null>(null)
  const current = seaPresentation(status)
  const presentation =
    active && home !== null && home.state === status?.uiState ? home : current
  if (!enabled) return children
  return (
    <BackdropContext value={setHome}>
      <div
        className="tono-sea-backdrop"
        data-visible={active}
        aria-hidden="true"
      >
        <SeaScene
          phase={presentation.phase}
          progress={
            'progress' in presentation ? presentation.progress : undefined
          }
          paused={!active}
        />
      </div>
      {children}
    </BackdropContext>
  )
}
