import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { nodeCityLabel } from '@/pages/tono/node-meta'
import type { TonoServer } from '@/services/tono'

import type { SeaPhase } from './SeaScene'
import './sea-tray.css'

export const SeaTray = ({
  tone,
  title,
  subtitle,
  phase,
  action,
  quiet,
  busy,
  onAction,
  quick,
  onSelect,
  traffic,
  ai,
  error,
  backup,
  picker,
  onOpen,
  onQuit,
}: {
  tone: string
  title: string
  subtitle: string
  phase: SeaPhase
  action: string
  quiet: boolean
  busy: boolean
  onAction: () => void
  quick: TonoServer[]
  onSelect: (name: string) => void
  traffic: string | null
  ai: boolean
  error: string | null
  backup: ReactNode
  picker: ReactNode
  onOpen: () => void
  onQuit: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div
      className="sea-tray"
      // The tray webview's root never carries the appearance flag; the tokens start here.
      data-sea-ui="true"
      role="dialog"
      aria-label="Tono"
      data-ground={tone}
    >
      <span className="sea-tray-mark" data-phase={phase} aria-hidden="true" />
      <h1>{title}</h1>
      <p title={subtitle}>{subtitle}</p>
      {(traffic || ai) && (
        <div className="sea-tray-info">
          {traffic}
          {ai && (
            <span title={t('tono.dashboard.claudeHomeActive')}>
              {' '}
              · Claude AI
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        className="sea-button sea-tray-action"
        data-variant={quiet ? 'quiet' : 'primary'}
        disabled={busy}
        onClick={onAction}
      >
        {action}
      </button>
      <fieldset className="sea-tray-choices">
        <legend className="tono-sr-only">{t('tono.tray.pickNode')}</legend>
        {/* The flyout is a fixed 232px window: a backup row or an error
            takes the place of a quick pick so the footer never scrolls away. */}
        {quick.slice(0, Math.max(0, 2 - (backup ? 1 : 0) - (error ? 1 : 0))).map((server) => (
          <button
            type="button"
            className="sea-tray-quick"
            key={server.name}
            onClick={() => onSelect(server.name)}
          >
            {nodeCityLabel(server.name, t)}
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </fieldset>
      {error && (
        <p className="sea-tray-error" role="alert">
          {error}
        </p>
      )}
      {backup}
      <footer>
        <div className="sea-tray-all">{picker}</div>
        <button type="button" onClick={onOpen}>
          {t('tono.tray.open')}
        </button>
        <button type="button" onClick={onQuit}>
          {t('tono.tray.quit')}
        </button>
      </footer>
    </div>
  )
}
