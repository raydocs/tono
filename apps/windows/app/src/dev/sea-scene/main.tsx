import i18n from 'i18next'
import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next, useTranslation } from 'react-i18next'

import en from '@/locales/en/tono.json'
import zh from '@/locales/zh/tono.json'
import {
  isMotionPreference,
  setMotionPreference,
  useAppearancePreferences,
} from '@/tono-ui/appearance-preferences'
import { publishSeaTraffic } from '@/tono-ui/sea-traffic'
import { SeaScene, type SeaPhase } from '@/tono-ui/SeaScene'

import './preview.css'

// Separate HTML entry, absent from the production import graph and build inputs.
if (!import.meta.env.DEV && !import.meta.env.VITE_SEA_SCENE_PREVIEW)
  throw new Error('SeaScene preview is development-only')

const parameters = new URLSearchParams(window.location.search)
const initialPhase = parameters.get('phase')
const initialQuality = parameters.get('quality')
if (isMotionPreference(initialQuality)) setMotionPreference(initialQuality)
// `?traffic=<bytes per second>` stands in for the dashboard's live throughput.
const previewTraffic = Number(parameters.get('traffic') ?? Number.NaN)
if (Number.isFinite(previewTraffic)) {
  publishSeaTraffic(previewTraffic)
  setInterval(() => publishSeaTraffic(previewTraffic), 1000)
}
const subscribeMedia = (notify: () => void) => {
  const queries = [
    '(prefers-reduced-motion: reduce)',
    '(forced-colors: active)',
  ].map((query) => matchMedia(query))
  for (const query of queries) query.addEventListener('change', notify)

  return () => {
    for (const query of queries) query.removeEventListener('change', notify)
  }
}
const reducedSnapshot = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  matchMedia('(forced-colors: active)').matches
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
  const preferences = useAppearancePreferences()
  const reduced = useSyncExternalStore(
    subscribeMedia,
    reducedSnapshot,
    () => true,
  )
  const [phase, setPhase] = useState<SeaPhase>(
    phases.find((candidate) => candidate === initialPhase) ?? 'connected',
  )
  const [paused, setPaused] = useState(parameters.has('static'))
  const [fit, setFit] = useState(parameters.has('fit'))
  const [useProgress, setUseProgress] = useState(parameters.has('progress'))
  const [progress, setProgress] = useState(
    Math.min(1, Math.max(0, Number(parameters.get('progress')) || 0)),
  )

  const quality =
    paused || reduced
      ? 'static'
      : preferences.motion === 'auto'
        ? preferences.automaticQuality
        : preferences.motion
  const report = preferences.report

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
        <output
          className="sea-preview-readout"
          data-probe-complete={preferences.measured ? 'true' : 'false'}
        >
          {t('tono.scenePreview.quality')}:{' '}
          {t(`tono.scenePreview.qualityModes.${quality}`)}
          <br />
          fps {report?.fps ? report.fps.toFixed(1) : '—'} · p95{' '}
          {report?.p95 ? `${report.p95.toFixed(1)} ms` : '—'}
          <br />
          {report?.renderer ?? t('tono.scenePreview.notSampled')}
          <br />
          {preferences.measured
            ? t('tono.scenePreview.probeFinished')
            : quality === 'static'
              ? t('tono.scenePreview.staticProbe')
              : t('tono.scenePreview.probePending')}
        </output>
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
        <label>
          {t('tono.scenePreview.quality')}
          <select
            value={preferences.motion}
            data-quality-input
            onChange={(event) => {
              if (isMotionPreference(event.target.value))
                setMotionPreference(event.target.value)
            }}
          >
            {(['auto', 'full', 'lite', 'static'] as const).map((mode) => (
              <option key={mode} value={mode}>
                {t(`tono.scenePreview.qualityModes.${mode}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-remeasure
          onClick={() => setMotionPreference(preferences.motion)}
        >
          {t('tono.scenePreview.remeasure')}
        </button>
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
