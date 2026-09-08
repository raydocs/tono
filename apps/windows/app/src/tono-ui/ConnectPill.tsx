import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeMode } from '@/services/states'
import type { TonoUiState } from '@/services/tono'
import { CONNECT_STAGE_LABEL_KEYS } from '@/tono-ui/connect-stages'

import './connect-motion.css'
import { TONO_COLORS, tonoText } from './theme'
import { TonoIcon } from './TonoIcon'
import { TonoLogo } from './TonoLogo'

/**
 * ConnectPill — the primary dashboard action. The wider desktop target keeps
 * the five-state color system while making the click affordance and live stage
 * text legible at Windows display scaling.
 */

interface StateSpec {
  color: string
  glowOpacity: number
  glowScale: number
  titleKey: string
  /** State color for the title; `notConnected` uses the primary text color. */
  titleColored: boolean
  indicator: 'dot' | 'spinner'
  disabled: boolean
}

const STATE_SPECS: Record<TonoUiState, StateSpec> = {
  notConnected: {
    color: TONO_COLORS.accent,
    glowOpacity: 0.18,
    glowScale: 1,
    titleKey: 'tono.pill.title.notConnected',
    titleColored: false,
    indicator: 'dot',
    disabled: false,
  },
  connecting: {
    color: TONO_COLORS.accent,
    glowOpacity: 0.26,
    glowScale: 1.03,
    titleKey: 'shared.actions.cancel',
    titleColored: true,
    indicator: 'spinner',
    disabled: false,
  },
  connected: {
    color: TONO_COLORS.connected,
    glowOpacity: 0.25,
    glowScale: 1.03,
    titleKey: 'tono.pill.title.connected',
    titleColored: true,
    indicator: 'dot',
    disabled: false,
  },
  protectedOffline: {
    color: TONO_COLORS.protectedOffline,
    glowOpacity: 0.22,
    glowScale: 1,
    titleKey: 'tono.pill.title.protectedOffline',
    titleColored: true,
    indicator: 'dot',
    disabled: false,
  },
  disconnecting: {
    color: TONO_COLORS.accent,
    glowOpacity: 0.24,
    glowScale: 1.03,
    titleKey: 'tono.pill.title.disconnecting',
    titleColored: true,
    indicator: 'spinner',
    disabled: true,
  },
}

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

interface ConnectPillProps {
  uiState: TonoUiState
  protectionConfirmed?: boolean
  /** Connect FSM stage key (`startingKillSwitch`). Translated in the pill. */
  stage?: string | null
  onConnect: () => void
  onDisconnect: () => void
}

export const ConnectPill = ({
  uiState,
  protectionConfirmed = false,
  stage,
  onConnect,
  onDisconnect,
}: ConnectPillProps) => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const spec = STATE_SPECS[uiState]
  const titleKey = uiState === 'protectedOffline' && !protectionConfirmed
    ? 'tono.pill.title.protectionUnknown'
    : spec.titleKey
  const stageKey = stage ? CONNECT_STAGE_LABEL_KEYS[stage] : undefined

  const subtitle =
    uiState === 'connecting'
      ? t(stageKey ?? 'tono.pill.subtitle.starting')
      : uiState === 'notConnected'
        ? t('tono.pill.subtitle.tapToConnect')
        : uiState === 'connected'
          ? t('tono.pill.subtitle.tapToDisconnect')
          : uiState === 'protectedOffline'
            ? t('tono.pill.subtitle.tapToRestore')
            : t('tono.pill.subtitle.restoringAccess')

  const handleClick = () => {
    if (spec.disabled) return
    if (
      uiState === 'connecting' ||
      uiState === 'connected' ||
      uiState === 'protectedOffline'
    ) {
      onDisconnect()
    } else {
      onConnect()
    }
  }

  const transition = 'var(--tono-duration-state) var(--tono-ease)'
  const connected = uiState === 'connected'

  return (
    <button
      type="button"
      className="tono-pill"
      aria-disabled={spec.disabled || undefined}
      onClick={handleClick}
      aria-label={`${t(titleKey)} — ${subtitle}`}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: 340,
        maxWidth: 'calc(100vw - 230px)',
        minHeight: 96,
        padding: '11px 14px 11px 11px',
        border: `1px solid ${hex(spec.color, dark ? 0.32 : 0.24)}`,
        borderRadius: 'var(--tono-radius-pill)',
        cursor: spec.disabled ? 'default' : 'pointer',
        color: text.primary,
        background: 'var(--tono-surface-pill)',
        boxShadow: connected
          ? 'var(--tono-shadow-pill-connected)'
          : 'var(--tono-shadow-pill)',
        transition: `background ${transition}, border-color ${transition}, box-shadow ${transition}, transform ${transition}`,
      }}
    >
      {/* Icon zone */}
      <span
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 72,
          height: 72,
          flexShrink: 0,
        }}
      >
        <span
          key={connected ? 'arrival' : 'idle'}
          aria-hidden
          className={
            connected
              ? 'tono-connect-glow tono-connect-glow--arrival'
              : 'tono-connect-glow'
          }
          style={
            {
              '--tono-connect-glow-color': hex(spec.color, 0.35),
              opacity: connected ? undefined : spec.glowOpacity,
              transform: connected ? undefined : `scale(${spec.glowScale})`,
            } as CSSProperties
          }
        />
        <TonoLogo connected={connected} size={54} />
      </span>

      {/* Text zone */}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 6,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontSize: 'var(--tono-size-pill-title)',
            fontWeight:
              'var(--tono-weight-title)' as CSSProperties['fontWeight'],
            lineHeight: 'var(--tono-leading-title)',
            letterSpacing: 'var(--tono-tracking-pill-title)',
            color: spec.titleColored && dark ? spec.color : text.primary,
            transition: `color ${transition}`,
          }}
        >
          {t(titleKey)}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            maxWidth: '100%',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.25,
            color: text.secondary,
          }}
        >
          {spec.indicator === 'dot' ? (
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                background: spec.color,
                transition: `background ${transition}`,
              }}
            />
          ) : (
            <span
              aria-hidden
              className="tono-spin"
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius: '50%',
                border: `1.5px solid ${hex(spec.color, 0.35)}`,
                borderTopColor: spec.color,
              }}
            />
          )}
          <span
            key={subtitle}
            className="tono-text-in"
            aria-live={
              uiState === 'connecting' || uiState === 'disconnecting'
                ? 'polite'
                : undefined
            }
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </span>
        </span>
      </span>

      <span
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 'var(--tono-radius-button)',
          color: spec.color,
          background: hex(spec.color, dark ? 0.14 : 0.1),
          border: `1px solid ${hex(spec.color, 0.18)}`,
        }}
      >
        <TonoIcon name="power" size={17} />
      </span>
    </button>
  )
}
