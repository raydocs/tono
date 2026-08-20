import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useTonoStatus } from '@/hooks/use-tono'
import { readNodeLatency } from '@/pages/tono/node-latency'
import { nodeCityTitleKey, nodeDisplayName } from '@/pages/tono/node-meta'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoConnect,
  tonoDisconnect,
  tonoRetryNow,
  type TonoUiState,
} from '@/services/tono'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'

/**
 * The tray flyout: state, node, one safe action, then Open Tono / Quit Tono.
 * Native right-click menu stays for keyboard/menu semantics.
 */

const STATUS_LABEL: Record<TonoUiState, string> = {
  notConnected: 'tono.dashboard.status.standby',
  connecting: 'tono.dashboard.status.connecting',
  connected: 'tono.dashboard.status.protected',
  protectedOffline: 'tono.dashboard.status.offline',
  disconnecting: 'tono.dashboard.status.disconnecting',
}

const STATUS_COLOR: Record<TonoUiState, string> = {
  notConnected: TONO_COLORS.gray,
  connecting: TONO_COLORS.accent,
  connected: TONO_COLORS.connected,
  protectedOffline: TONO_COLORS.protectedOffline,
  disconnecting: TONO_COLORS.accent,
}

type Action = 'connect' | 'disconnect' | 'retry' | null

const actionFor = (uiState: TonoUiState): Action => {
  switch (uiState) {
    case 'notConnected':
      return 'connect'
    case 'connected':
      return 'disconnect'
    case 'protectedOffline':
      return 'retry'
    default:
      return null
  }
}

const ACTION_LABEL: Record<Exclude<Action, null>, string> = {
  connect: 'tono.tray.connect',
  disconnect: 'tono.tray.disconnect',
  retry: 'tono.tray.retry',
}

export const TrayPanel = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()
  const uiState: TonoUiState = status?.uiState ?? 'notConnected'
  const color = STATUS_COLOR[uiState]
  const action = actionFor(uiState)
  const busy = action == null
  const serverName = status?.selectedServer
  const cityKey = serverName ? nodeCityTitleKey(serverName) : null
  const city = serverName
    ? cityKey
      ? t(cityKey)
      : nodeDisplayName(serverName)
    : t('tono.tray.noServer')
  const latency = serverName ? readNodeLatency(serverName) : null

  const runAction = useLockFn(async () => {
    if (!action) return
    try {
      if (action === 'connect') await tonoConnect()
      else if (action === 'disconnect') await tonoDisconnect()
      else await tonoRetryNow()
      await mutateTonoStatus()
    } catch (error) {
      console.warn('[TrayPanel]', formatTonoActionError(error, t))
    }
  })

  const secondary: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minHeight: 32,
    padding: '0 10px',
    border: 'none',
    borderRadius: 'var(--tono-radius-sm)',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    color: text.secondary,
  }

  return (
    <div
      role="dialog"
      aria-label="Tono"
      style={{
        width: 296,
        height: '100%',
        padding: 8,
        boxSizing: 'border-box',
        borderRadius: 'var(--tono-radius-card-sm)',
        background: 'var(--tono-surface-flyout)',
        border: '1px solid var(--tono-surface-flyout-border)',
        boxShadow: 'var(--tono-shadow-flyout)',
        backdropFilter: 'var(--tono-glass-blur-strong)',
        WebkitBackdropFilter: 'var(--tono-glass-blur-strong)',
        color: text.primary,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px 10px',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            flexShrink: 0,
            borderRadius: 11,
            color,
            background: `${color}24`,
            border: `1px solid ${color}38`,
          }}
        >
          <TonoIcon
            name={uiState === 'connected' ? 'shieldCheck' : 'shield'}
            size={17}
          />
        </span>
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 650,
              letterSpacing: -0.2,
              color,
              lineHeight: 1.2,
            }}
          >
            {t(STATUS_LABEL[uiState])}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: text.tertiary,
              minWidth: 0,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {city}
            </span>
            {latency != null && (
              <span style={{ fontFamily: TONO_MONO_STACK, flexShrink: 0 }}>
                · {latency}ms
              </span>
            )}
          </span>
        </span>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void runAction()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          width: '100%',
          minHeight: 38,
          padding: '9px 14px',
          border: 'none',
          borderRadius: 'var(--tono-radius-button)',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.55 : 1,
          color: action === 'disconnect' ? text.primary : '#fff',
          background:
            action === 'connect'
              ? 'var(--tono-accent)'
              : action === 'retry'
                ? 'var(--tono-protected-offline)'
                : 'var(--tono-surface-input)',
          boxShadow:
            action === 'disconnect'
              ? 'inset 0 0 0 1px var(--tono-surface-flyout-border)'
              : 'none',
        }}
      >
        {!busy && (
          <TonoIcon
            name={action === 'retry' ? 'refresh' : 'power'}
            size={14}
          />
        )}
        {action
          ? t(ACTION_LABEL[action])
          : t(
              uiState === 'disconnecting'
                ? 'tono.tray.disconnecting'
                : 'tono.tray.connecting',
            )}
      </button>

      <div
        aria-hidden
        style={{
          height: 1,
          margin: '8px 6px',
          background: 'var(--tono-divider)',
        }}
      />

      <button
        type="button"
        onClick={() => void invoke('tray_flyout_open_dashboard')}
        style={secondary}
      >
        <TonoIcon name="dashboard" size={14} />
        {t('tono.tray.open')}
      </button>
      <button
        type="button"
        onClick={() => void invoke('tray_flyout_quit')}
        style={secondary}
      >
        <TonoIcon name="close" size={14} />
        {t('tono.tray.quit')}
      </button>
    </div>
  )
}
