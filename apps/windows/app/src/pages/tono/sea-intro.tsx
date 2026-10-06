import { useEffect, useRef, useState } from 'react'
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

/** Educational scenery, never a status/protection assertion or connection action. */
export const SeaIntro = ({ onFinish }: { onFinish: () => void }) => {
  const { t } = useTranslation()
  const [panel, setPanel] = useState(0)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    primaryRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setPanel((current) =>
          Math.max(
            0,
            Math.min(2, current + (event.key === 'ArrowRight' ? 1 : -1)),
          ),
        )
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const current = PANELS[panel] ?? PANELS[0]
  return (
    <section
      className="sea-intro"
      aria-labelledby="sea-intro-title"
      data-scene-purpose="introduction"
    >
      <div className="sea-welcome-scene">
        <SeaScene phase={current.phase as SeaPhase} />
      </div>
      <div className="sea-intro-copy" aria-live="polite">
        <p className="tono-welcome__eyebrow">Tono · {panel + 1} / 3</p>
        <h1 id="sea-intro-title">{t(current.title)}</h1>
        <p>{t(current.body)}</p>
        {panel === 2 && (
          <span className="sea-intro-line">{t('tono.seaIntro.line')}</span>
        )}
        <div className="sea-intro-actions">
          <button
            type="button"
            className="sea-button"
            data-variant="primary"
            ref={primaryRef}
            onClick={() => (panel === 2 ? onFinish() : setPanel(panel + 1))}
          >
            {t(panel === 2 ? 'tono.intro.getStarted' : 'tono.seaIntro.next')}
          </button>
          {panel < 2 && (
            <SeaButton variant="text" onClick={onFinish}>
              {t('tono.seaIntro.skip')}
            </SeaButton>
          )}
        </div>
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
              onClick={() => setPanel(index)}
            >
              <span />
            </button>
          ))}
        </fieldset>
      </div>
    </section>
  )
}
