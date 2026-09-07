import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { writeTonoIntroSeen } from '@/pages/_layout/tono-guard'
import { WelcomeHeroTile } from '@/tono-ui/WelcomeHeroTile'

const LAST_STEP = 3

const STEP_KEYS = [
  { headline: 'tono.intro.step1.headline', body: 'tono.intro.step1.body' },
  { headline: 'tono.intro.step2.headline', body: 'tono.intro.step2.body' },
  { headline: 'tono.intro.step3.headline', body: 'tono.intro.step3.body' },
] as const

const IntroPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const headlineRef = useRef<HTMLHeadingElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const isLast = step >= LAST_STEP
  const copy = STEP_KEYS[step] ?? STEP_KEYS[0]

  const finish = useCallback(() => {
    writeTonoIntroSeen()
    navigate('/login', { replace: true })
  }, [navigate])

  const advance = useCallback(() => {
    if (step >= LAST_STEP) {
      finish()
      return
    }
    setStep((current) => current + 1)
  }, [finish, step])

  useEffect(() => {
    if (isLast) {
      startRef.current?.focus()
      return
    }
    headlineRef.current?.focus()
  }, [isLast, step])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
        return
      }
      if (event.key !== 'ArrowRight' && event.key !== 'Enter') return
      const target = event.target
      if (
        event.key === 'Enter' &&
        target instanceof HTMLElement &&
        target.closest('button')
      ) {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, finish])

  return (
    <section
      className={`tono-intro tono-welcome-ground${isLast ? ' tono-intro--final' : ''}`}
      aria-label={t('tono.intro.landmark')}
    >
      <button
        type="button"
        className="tono-link tono-intro__skip"
        onClick={finish}
      >
        {t('tono.intro.skip')}
      </button>
      <div className="tono-intro__figure" aria-hidden="true">
        <WelcomeHeroTile />
      </div>
      <div className="tono-intro__copy" aria-live="polite">
        {isLast ? (
          <button
            ref={startRef}
            type="button"
            className="tono-intro__start"
            onClick={finish}
          >
            {t('tono.intro.getStarted')}
          </button>
        ) : (
          <>
            <h1
              ref={headlineRef}
              tabIndex={-1}
              className="tono-intro__headline"
            >
              {t(copy.headline)}
            </h1>
            <p>{t(copy.body)}</p>
          </>
        )}
      </div>
      <div className="tono-intro__nav">
        <div
          className="tono-intro__dots"
          role="group"
          aria-label={t('tono.intro.progress', { step: step + 1 })}
        >
          {[1, 2, 3, 4].map((dot) => (
            <span
              key={dot}
              className="tono-intro__dot"
              aria-current={dot === step + 1 ? 'step' : undefined}
            />
          ))}
        </div>
        {!isLast && (
          <button
            type="button"
            className="tono-link tono-intro__next"
            onClick={advance}
          >
            {t('tono.intro.next')}
          </button>
        )}
      </div>
    </section>
  )
}

export default IntroPage
