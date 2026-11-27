import { useTranslation } from 'react-i18next'

import { useThemeMode } from '@/services/states'

import { useAppearancePreferences } from './appearance-preferences'
import { TONO_COLORS, tonoText } from './theme'

export const TrayUpdateNotice = ({
  version,
  onUpdateNow,
  onLater,
}: {
  version: string
  onUpdateNow: () => void
  onLater: () => void
}) => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)

  return (
    <div
      className="sea-tray-update"
      role="status"
      style={{
        padding: '8px 10px',
        borderRadius: 12,
        background: newAppearance
          ? 'rgba(255, 255, 255, 0.08)'
          : dark
            ? 'rgba(171, 158, 255, 0.12)'
            : 'rgba(116, 87, 245, 0.08)',
        border: `1px solid ${
          newAppearance
            ? 'rgba(255, 255, 255, 0.14)'
            : dark
              ? 'rgba(171, 158, 255, 0.25)'
              : 'rgba(116, 87, 245, 0.2)'
        }`,
        boxShadow: newAppearance
          ? 'inset 0 1px 0 rgba(255, 255, 255, 0.14)'
          : undefined,
      }}
    >
      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '0 0 6px',
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.35,
          color: newAppearance ? 'var(--sea-text)' : text.primary,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: newAppearance
              ? 'var(--sea-accent)'
              : TONO_COLORS.accent,
            boxShadow: newAppearance
              ? '0 0 8px var(--sea-accent)'
              : `0 0 6px ${TONO_COLORS.accent}`,
          }}
        />
        <span>{t('tono.update.trayAvailable', { version })}</span>
      </p>
      <div className="sea-tray-update-actions" style={{ gap: 6 }}>
        <button
          type="button"
          onClick={onUpdateNow}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '5px 10px',
            borderRadius: 999,
            background: newAppearance
              ? 'var(--sea-primary)'
              : TONO_COLORS.accent,
            color: newAppearance ? '#1a0f0a' : '#ffffff',
          }}
        >
          {t('tono.update.updateNow')}
        </button>
        <button
          type="button"
          onClick={onLater}
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: '5px 10px',
            borderRadius: 999,
            background: newAppearance
              ? 'rgba(255, 255, 255, 0.1)'
              : dark
                ? 'rgba(255, 255, 255, 0.1)'
                : 'rgba(20, 22, 30, 0.08)',
            color: newAppearance ? 'var(--sea-secondary)' : text.secondary,
          }}
        >
          {t('tono.update.later')}
        </button>
      </div>
    </div>
  )
}
