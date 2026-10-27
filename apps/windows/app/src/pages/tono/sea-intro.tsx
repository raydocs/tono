import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { SeaButton } from '@/tono-ui/SeaControls'
import { SeaScene, type SeaPhase } from '@/tono-ui/SeaScene'

import './sea-welcome.css'

const PANELS = [
  {
    phase: 'connected',
    title: 'tono.intro.step1.headline',
    body: 'tono.intro.step1.body',
  },
  {
    phase: 'failed',
    title: 'tono.intro.step2.headline',
    body: 'tono.intro.step2.body',
  },
  {
    phase: 'idle',
    title: 'tono.intro.step3.headline',
    body: 'tono.intro.step3.body',
  },
] as const
const LAST = PANELS.length - 1

/** Educational scenery, never a status/protection assertion or connection action. */
export const SeaIntro = ({ onFinish }: { onFinish: () => void }) => {
  const { t } = useTranslation()
  // `direction` lets the copy enter from the side the user is heading to.
  const [step, setStep] = useState({ panel: 0, direction: 1 })
  const { panel, direction } = step
  const primaryRef = useRef<HTMLButtonElement>(null)
  const goTo = (target: number) => {
    const next = Math.max(0, Math.min(LAST, target))
    setStep((current) =>
      next === current.panel
        ? current
        : { panel: next, direction: next > current.panel ? 1 : -1 },
    )
    // Back disappears on the first panel; keep focus on the next action.
    if (next === 0) primaryRef.current?.focus()
  }
  useEffect(() => {
    primaryRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(panel + (event.key === 'ArrowRight' ? 1 : -1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panel])
  const current = PANELS[panel] ?? PANELS[0]
  const last = panel === LAST
  return (
    <section
      className="sea-intro"
      aria-labelledby="sea-intro-title"
      data-scene-purpose="introduction"
    >
      <div className="sea-welcome-scene">
        <SeaScene phase={current.phase as SeaPhase} />
      </div>
      <div className="sea-intro-copy">
        <div className="sea-intro-top">
          <fieldset
            className="sea-intro-pager"
            aria-label={t('tono.intro.landmark')}
          >
            {PANELS.map((item, index) => (
              <button
                type="button"
                key={item.title}
                aria-label={t(item.title)}
                aria-current={index === panel ? 'step' : undefined}
                data-seen={index < panel}
                onClick={() => goTo(index)}
              >
                <span />
              </button>
            ))}
          </fieldset>
          <span className="sea-intro-count" aria-hidden="true">
            {panel + 1} / {PANELS.length}
          </span>
          {!last && (
            <SeaButton
              variant="text"
              className="sea-intro-skip"
              onClick={onFinish}
            >
              {t('tono.seaIntro.skip')}
            </SeaButton>
          )}
        </div>
        <div aria-live="polite">
          <div
            key={panel}
            className="sea-intro-panel"
            style={{ '--sea-intro-dir': direction } as CSSProperties}
          >
            <h1 id="sea-intro-title">{t(current.title)}</h1>
            <p>{t(current.body)}</p>
          </div>
        </div>
        <div className="sea-intro-actions">
          <button
            type="button"
            className="sea-button"
            data-variant="primary"
            ref={primaryRef}
            onClick={() => (last ? onFinish() : goTo(panel + 1))}
          >
            {t(last ? 'tono.intro.getStarted' : 'tono.seaIntro.next')}
          </button>
          {panel > 0 && (
            <SeaButton variant="text" onClick={() => goTo(panel - 1)}>
              {t('tono.seaIntro.back')}
            </SeaButton>
          )}
        </div>
        {/* Below the actions, so they stay put when it appears. */}
        {last && (
          <span className="sea-intro-line">{t('tono.seaIntro.line')}</span>
        )}
      </div>
    </section>
  )
}
