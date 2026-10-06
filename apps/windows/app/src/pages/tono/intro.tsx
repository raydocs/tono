import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { writeTonoIntroSeen } from '@/pages/_layout/tono-guard'
import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { WelcomeHeroTile } from '@/tono-ui/WelcomeHeroTile'

import { SeaIntro } from './sea-intro'

const POINT_KEYS = [
  { headline: 'tono.intro.step1.headline', body: 'tono.intro.step1.body' },
  { headline: 'tono.intro.step2.headline', body: 'tono.intro.step2.body' },
  { headline: 'tono.intro.step3.headline', body: 'tono.intro.step3.body' },
] as const

const IntroPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { newAppearance } = useAppearancePreferences()
  const startRef = useRef<HTMLButtonElement>(null)

  const finish = useCallback(() => {
    writeTonoIntroSeen()
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      finish()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finish])

  if (newAppearance) return <SeaIntro onFinish={finish} />

  return (
    <section
      className="tono-intro tono-welcome-ground"
      aria-labelledby="tono-intro-title"
    >
      <div className="tono-intro__copy">
        <h1 id="tono-intro-title">{t('tono.intro.landmark')}</h1>
        <ul className="tono-intro__points">
          {POINT_KEYS.map((point) => (
            <li key={point.headline}>
              <strong>{t(point.headline)}</strong>
              <span>{t(point.body)}</span>
            </li>
          ))}
        </ul>
        <button
          ref={startRef}
          type="button"
          className="tono-button tono-action tono-intro__start"
          onClick={finish}
        >
          {t('tono.intro.getStarted')}
        </button>
      </div>
      <div className="tono-intro__figure" aria-hidden="true">
        <WelcomeHeroTile />
      </div>
    </section>
  )
}

export default IntroPage
