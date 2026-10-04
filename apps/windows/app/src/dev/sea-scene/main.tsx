import i18n from 'i18next'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next, useTranslation } from 'react-i18next'

import en from '@/locales/en/tono.json'
import zh from '@/locales/zh/tono.json'
import { SeaScene, type SeaPhase } from '@/tono-ui/SeaScene'

import './preview.css'

// Separate HTML entry, absent from the production import graph and build inputs.
if (!import.meta.env.DEV)
  throw new Error('SeaScene preview is development-only')

const parameters = new URLSearchParams(window.location.search)
const initialPhase = parameters.get('phase')
const phases: readonly SeaPhase[] = [
  'connected',
  'connecting',
  'failed',
  'idle',
]

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { tono: en } },
    zh: { translation: { tono: zh } },
  },
  lng: parameters.get('lang') === 'zh' ? 'zh' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export const Preview = () => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<SeaPhase>(
    phases.find((candidate) => candidate === initialPhase) ?? 'connected',
  )
  const [paused, setPaused] = useState(parameters.has('static'))
  const [fit, setFit] = useState(parameters.has('fit'))
  const [useProgress, setUseProgress] = useState(parameters.has('progress'))
  const [progress, setProgress] = useState(
    Math.min(1, Math.max(0, Number(parameters.get('progress')) || 0)),
  )

  return (
    <>
      <main
        className="sea-preview-window"
        style={{
          position: 'relative',
          width: fit ? '100vw' : 920,
          height: fit ? 'calc(100vh - 64px)' : 600,
          minWidth: 860,
          minHeight: 540,
          overflow: 'hidden',
        }}
      >
        <SeaScene
          phase={phase}
          paused={paused}
          progress={useProgress ? progress : undefined}
        />
        <p
          className="sea-preview-notice"
          style={{ position: 'absolute', left: 24, top: 12, margin: 0 }}
        >
          {t('tono.scenePreview.notice')}
        </p>
        <div
          style={{
            position: 'absolute',
            left: 56,
            top: '22%',
            maxWidth: '48%',
          }}
        >
          <h1 className="sea-preview-title" aria-live="polite">
            {t(`tono.scenePreview.${phase}`)}
          </h1>
          <p className="sea-preview-detail">{t('tono.scenePreview.detail')}</p>
        </div>
        <div
          className="sea-preview-dock"
          style={{
            position: 'absolute',
            left: 56,
            right: 56,
            bottom: 32,
            height: 68,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
            boxSizing: 'border-box',
            borderRadius: 999,
          }}
        >
          <span>{t('tono.scenePreview.node')}</span>
          <button
            type="button"
            onClick={() =>
              setPhase(phase === 'connected' ? 'idle' : 'connected')
            }
          >
            {t('tono.scenePreview.action')}
          </button>
        </div>
      </main>
      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 64,
          padding: '0 20px',
          boxSizing: 'border-box',
          flexWrap: 'wrap',
        }}
      >
        {phases.map((candidate) => (
          <button
            key={candidate}
            type="button"
            data-set-phase={candidate}
            aria-pressed={phase === candidate}
            onClick={() => setPhase(candidate)}
          >
            {t(`tono.scenePreview.${candidate}`)}
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
          />
          {t('tono.scenePreview.paused')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={fit}
            onChange={(event) => setFit(event.target.checked)}
          />
          {t('tono.scenePreview.viewport')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={useProgress}
            onChange={(event) => setUseProgress(event.target.checked)}
          />
          {t('tono.scenePreview.useProgress')}
        </label>
        <label>
          {t('tono.scenePreview.progress')}
          <input
            type="range"
            min={0}
            max={1}
            step={0.125}
            value={progress}
            disabled={!useProgress}
            data-progress-input
            onChange={(event) => setProgress(Number(event.target.value))}
          />
        </label>
      </footer>
    </>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('Missing SeaScene preview root')
createRoot(container).render(<Preview />)
