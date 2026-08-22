import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { tonoServersQueryKey, useTonoStatus } from '@/hooks/use-tono'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { readNodeLatency } from '@/pages/tono/node-latency'
import {
  nodeCityParts,
  nodeCityTitleKey,
  nodeCode,
  nodeDisplayName,
} from '@/pages/tono/node-meta'
import { useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoConnect,
  tonoDisconnect,
  tonoRetryNow,
  tonoSelectServer,
  tonoServers,
  type TonoUiState,
} from '@/services/tono'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoNodeBadge } from '@/tono-ui/TonoNodeBadge'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import parseTraffic from '@/utils/parse-traffic'

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

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

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
  const cityParts = serverName ? nodeCityParts(serverName) : null
  const region = serverName ? nodeCode(serverName) : null
  const latency = serverName ? readNodeLatency(serverName) : null
  const connected = uiState === 'connected'
  const {
    response: { data: traffic },
  } = useTrafficData({
    enabled: connected,
    generation: status?.controllerGeneration,
  })
  const [up, upUnit] = parseTraffic(traffic?.up ?? 0)
  const [down, downUnit] = parseTraffic(traffic?.down ?? 0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const { data: servers } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
    enabled: picking,
  })

  const runAction = useLockFn(async () => {
    if (!action) return
    setPicking(false)
    setActionError(null)
    try {
      if (action === 'connect') await tonoConnect()
      else if (action === 'disconnect') await tonoDisconnect()
      else await tonoRetryNow()
      await mutateTonoStatus()
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })

  const pickServer = useLockFn(async (name: string) => {
    setActionError(null)
    try {
      await tonoSelectServer(name)
      await mutateTonoStatus()
      setPicking(false)
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })

  return (
    <div className="tono-tray-panel" role="dialog" aria-label="Tono">
      <div className="tono-tray-head">
        <TonoNodeBadge size={32} city={cityParts?.city} />
        <button
          type="button"
          className="tono-tray-node"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          title={t('tono.tray.pickNode')}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 2,
            }}
          >
            <span
              aria-hidden
              className="tono-tray-dot"
              style={{
                background: color,
                boxShadow: `0 0 6px ${hex(color, 0.65)}`,
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 650,
                letterSpacing: -0.2,
                color: text.primary,
              }}
            >
              {t(STATUS_LABEL[uiState])}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              color: text.secondary,
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
            {region && (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: 0.3,
                  color: text.tertiary,
                }}
              >
                {region}
              </span>
            )}
            {latency != null && (
              <span
                style={{
                  fontFamily: TONO_MONO_STACK,
                  flexShrink: 0,
                  fontSize: 11,
                  color: text.tertiary,
                }}
              >
                {latency}ms
              </span>
            )}
            <TonoIcon name="chevronDown" size={11} />
          </div>
        </button>
      </div>

      {picking && (
        <div className="tono-tray-picker">
          {(servers ?? []).slice(0, 8).map((server) => {
            const key = nodeCityTitleKey(server.name)
            const label = key ? t(key) : nodeDisplayName(server.name)
            const active = server.selected || server.name === serverName
            return (
              <button
                key={server.name}
                type="button"
                className="tono-tray-pick"
                disabled={!server.available && !active}
                onClick={() => {
                  if (active) {
                    setPicking(false)
                    return
                  }
                  void pickServer(server.name)
                }}
                style={{
                  color: active ? text.primary : text.secondary,
                  fontWeight: active ? 650 : 500,
                  opacity: server.available || active ? 1 : 0.45,
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
                <span style={{ flexShrink: 0, fontSize: 10, color: text.tertiary }}>
                  {nodeCode(server.name) ?? ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {connected && (
        <div className="tono-tray-traffic" style={{ color: text.secondary }}>
          <span style={{ color: '#64D2FF' }}>
            ↑ {up} {upUnit}/s
          </span>
          <span style={{ color: TONO_COLORS.connected }}>
            ↓ {down} {downUnit}/s
          </span>
        </div>
      )}

      {actionError && (
        <div className="tono-tray-error" role="alert">
          {actionError}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void runAction()}
        className="tono-tray-action"
        style={{
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          background:
            action === 'disconnect'
              ? dark
                ? 'rgba(255,255,255,0.12)'
                : 'rgba(20,22,30,0.82)'
              : action === 'retry'
                ? TONO_COLORS.protectedOffline
                : TONO_COLORS.accent,
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

      <div className="tono-tray-foot">
        <button
          type="button"
          className="tono-tray-quiet"
          style={{ color: text.secondary }}
          onClick={() => void invoke('tray_flyout_open_dashboard')}
        >
          {t('tono.tray.open')}
        </button>
        <span className="tono-tray-rule" />
        <button
          type="button"
          className="tono-tray-quiet"
          style={{ color: text.secondary }}
          onClick={() => void invoke('tray_flyout_quit')}
        >
          {t('tono.tray.quit')}
        </button>
      </div>
    </div>
  )
}
