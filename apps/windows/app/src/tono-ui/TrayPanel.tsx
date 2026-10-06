import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  tonoConnectProgressQueryKey,
  tonoServersQueryKey,
  useTonoStatus,
} from '@/hooks/use-tono'
import { useTrafficData } from '@/hooks/use-traffic-data'
import {
  latencyColor,
  latencyLabelKey,
  latencyLabelVars,
  readNodeLatency,
} from '@/pages/tono/node-latency'
import {
  catalogBaseName,
  hy2UdpIsVendorBlocked,
  nodeCityLabel,
  nodeCityParts,
  nodeCode,
} from '@/pages/tono/node-meta'
import {
  preferencesMatch,
  recommendRoute,
  recentRoutes,
  unstableRoute,
} from '@/pages/tono/route-preferences'
import { useManualBackupChannel } from '@/pages/tono/use-backup-channel'
import { useQuery } from '@/services/query-client'
import { connectIfIdleAfterSelection } from '@/services/server-selection'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  idleSelectShouldConnect,
  isSupersededConnectRejection,
  tonoConnect,
  tonoConnectProgress,
  tonoRoutePreferences,
  tonoDisconnect,
  tonoRetryNow,
  tonoSelectServer,
  tonoServers,
  type TonoUiState,
} from '@/services/tono'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoNodeBadge } from '@/tono-ui/TonoNodeBadge'
import parseTraffic from '@/utils/parse-traffic'

import { useAppearancePreferences } from './appearance-preferences'
import { seaPresentation } from './sea-presentation'
import { SeaTray } from './SeaTray'

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

let appearanceQueue = Promise.resolve()

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

export const TrayPanel = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    appearanceQueue = appearanceQueue
      .then(() =>
        invoke<void>('tray_flyout_set_appearance', { enabled: newAppearance }),
      )
      .catch(() => {
        // Size failure is not protection evidence. Native placement requires hosted/hardware checks.
      })
  }, [newAppearance])
  useEffect(() => {
    if (!newAppearance) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [newAppearance])
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()
  const uiState: TonoUiState = status?.uiState ?? 'notConnected'
  const color = STATUS_COLOR[uiState]
  const action =
    newAppearance && uiState === 'connecting'
      ? 'disconnect'
      : actionFor(uiState)
  const busy = action == null
  const serverName = status?.selectedServer
  const city = serverName
    ? nodeCityLabel(serverName, t)
    : t('tono.tray.noServer')
  const cityParts = serverName ? nodeCityParts(serverName) : null
  const region = serverName ? nodeCode(serverName) : null
  const latency = serverName ? readNodeLatency(serverName) : null
  const connected = uiState === 'connected'
  const {
    response: { data: traffic },
    live: trafficLive,
  } = useTrafficData({
    enabled: connected,
    generation: status?.controllerGeneration,
  })
  const [up, upUnit] = parseTraffic(traffic?.up ?? 0)
  const [down, downUnit] = parseTraffic(traffic?.down ?? 0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const { available: backupAvailable, selectAndRetry } = useManualBackupChannel(
    serverName,
    uiState,
  )

  const { data: servers } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
    enabled: picking || newAppearance,
  })

  const scope = status?.routePreferenceScope
  const { data: storedPreferences } = useQuery({
    queryKey: ['tono', 'route-preferences', scope, status?.catalogRevision],
    queryFn: tonoRoutePreferences,
    enabled: newAppearance && !!scope,
    refetchInterval: newAppearance ? 30_000 : false,
  })
  const { data: progress } = useQuery({
    queryKey: tonoConnectProgressQueryKey,
    queryFn: tonoConnectProgress,
    enabled:
      newAppearance &&
      (uiState === 'connecting' || uiState === 'protectedOffline'),
    refetchInterval:
      newAppearance &&
      (uiState === 'connecting' || uiState === 'protectedOffline')
        ? 1000
        : false,
  })
  const preferences = preferencesMatch(
    storedPreferences,
    scope,
    status?.catalogRevision,
  )
    ? storedPreferences
    : undefined
  const recommendation = recommendRoute(
    servers ?? [],
    preferences,
    scope,
    status?.catalogRevision,
    { scope: null, revision: null, atMs: 0, latencies: {}, failures: {} },
    now,
    unstableRoute(status, now),
  )
  const candidates = preferences
    ? [
        recommendation?.name,
        ...(servers ?? [])
          .filter((server) =>
            preferences.favorites.includes(catalogBaseName(server.name)),
          )
          .map((server) => server.name),
        ...recentRoutes(preferences, servers ?? [], now)
          .filter((entry) => entry.revision === status?.catalogRevision)
          .map((entry) => entry.name),
      ]
    : []
  const quick = [...new Set(candidates)]
    .flatMap((name) => {
      const server = servers?.find(
        (server) =>
          server.name === name &&
          server.available &&
          server.name !== serverName &&
          !hy2UdpIsVendorBlocked(server.name),
      )
      return server ? [server] : []
    })
    .slice(0, 2)

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
      // A newer click won, or this connect overlapped one still running. That
      // is not a failed attempt; show the live state, as the dashboard does.
      if (action === 'connect' && isSupersededConnectRejection(error)) {
        await mutateTonoStatus()
        return
      }
      setActionError(formatTonoActionError(error, t))
    }
  })

  const tryBackup = useLockFn(async () => {
    setPicking(false)
    setActionError(null)
    try {
      await selectAndRetry()
      await mutateTonoStatus()
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })

  const pickServer = useLockFn(async (name: string) => {
    setActionError(null)
    try {
      await tonoSelectServer(name)
      await connectIfIdleAfterSelection()
      await mutateTonoStatus()
      setPicking(false)
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })

  if (newAppearance) {
    const presentation = seaPresentation(status)
    const subtitle =
      uiState === 'connecting'
        ? (status?.stageLabel ?? t('tono.tray.connecting'))
        : uiState === 'protectedOffline' && progress?.nextRetryAtMs
          ? t('tono.progress.retryIn', {
              n: progress.retryAttempt,
              seconds: Math.max(
                0,
                Math.ceil((progress.nextRetryAtMs - now) / 1000),
              ),
            })
          : latency != null
            ? t(latencyLabelKey('cached', latency), latencyLabelVars(latency))
            : ''
    return (
      <SeaTray
        tone={presentation.tone}
        title={t(presentation.titleKey)}
        subtitle={`${city}${subtitle ? ` · ${subtitle}` : ''}`}
        phase={presentation.phase}
        action={
          action
            ? uiState === 'connecting'
              ? t('tono.dashboard.cancelConnecting')
              : t(ACTION_LABEL[action])
            : t(
                uiState === 'disconnecting'
                  ? 'tono.tray.disconnecting'
                  : 'tono.tray.connecting',
              )
        }
        quiet={action === 'disconnect'}
        busy={busy}
        onAction={() => void runAction()}
        quick={
          uiState === 'connecting' || uiState === 'disconnecting' ? [] : quick
        }
        onSelect={(name) => void pickServer(name)}
        traffic={
          connected && trafficLive
            ? `↑ ${up} ${upUnit}/s · ↓ ${down} ${downUnit}/s`
            : null
        }
        ai={connected && status?.claudeHomeActive === true}
        error={actionError}
        backup={
          backupAvailable ? (
            <button
              type="button"
              data-testid="tono-tray-try-backup"
              className="sea-button"
              data-variant="text"
              onClick={() => void tryBackup()}
            >
              {t('tono.progress.tryBackupChannel')}
            </button>
          ) : null
        }
        picker={
          <details>
            <summary>{t('tono.tray.pickNode')}</summary>
            {(servers ?? [])
              .filter((server) => !hy2UdpIsVendorBlocked(server.name))
              .map((server) => (
                <button
                  type="button"
                  className="sea-tray-quick"
                  key={server.name}
                  disabled={!server.available}
                  onClick={() => {
                    if (server.selected && !idleSelectShouldConnect(uiState))
                      return
                    void pickServer(server.name)
                  }}
                >
                  {nodeCityLabel(server.name, t)}
                </button>
              ))}
          </details>
        }
        onOpen={() => void invoke('tray_flyout_open_dashboard')}
        onQuit={() => void invoke('tray_flyout_quit')}
      />
    )
  }

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
              {t(
                uiState === 'protectedOffline' && !hasLiveProtection(status)
                  ? 'tono.pill.title.protectionUnknown'
                  : STATUS_LABEL[uiState],
              )}
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
                  // readNodeLatency returns the exit's generate_204 delay, the
                  // same measurement the dashboard speaks in seconds. Printing
                  // it raw made the tray say "816ms" for a node the dashboard
                  // called "0.8 秒", and it carried no band colour at all.
                  color: latencyColor(latency, 'cached'),
                }}
              >
                {t(
                  latencyLabelKey('cached', latency),
                  latencyLabelVars(latency),
                )}
              </span>
            )}
            <TonoIcon name="chevronDown" size={11} />
          </div>
        </button>
      </div>

      {picking && (
        <div className="tono-tray-picker">
          {(servers ?? []).map((server) => {
            const label = nodeCityLabel(server.name, t)
            const active = server.selected || server.name === serverName
            return (
              <button
                key={server.name}
                type="button"
                className="tono-tray-pick"
                disabled={!server.available && !active}
                onClick={() => {
                  if (active && !idleSelectShouldConnect(uiState)) {
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
                <span
                  style={{ flexShrink: 0, fontSize: 10, color: text.tertiary }}
                >
                  {nodeCode(server.name) ?? ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {connected && (
        <div className="tono-tray-traffic" style={{ color: text.secondary }}>
          {/* A retained sample is not current throughput: hide the /s claims
              while the controller feed is unavailable. */}
          {trafficLive && (
            <>
              <span style={{ color: '#64D2FF' }}>
                ↑ {up} {upUnit}/s
              </span>
              <span style={{ color: TONO_COLORS.connected }}>
                ↓ {down} {downUnit}/s
              </span>
            </>
          )}
          {status?.claudeHomeActive && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 650,
                color: TONO_COLORS.latencyGood,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
              title={t('tono.dashboard.claudeHomeActive')}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TONO_COLORS.latencyGood,
                }}
              />
              Claude AI
            </span>
          )}
        </div>
      )}

      {actionError && (
        <div className="tono-tray-error" role="alert" title={actionError}>
          {actionError}
        </div>
      )}

      {backupAvailable && (
        <button
          type="button"
          data-testid="tono-tray-try-backup"
          onClick={() => void tryBackup()}
          className="tono-tray-action"
          style={{
            flexShrink: 0,
            cursor: 'pointer',
            background: TONO_COLORS.accent,
          }}
        >
          <TonoIcon name="refresh" size={14} />
          {t('tono.progress.tryBackupChannel')}
        </button>
      )}

      <button
        type="button"
        aria-disabled={busy || undefined}
        onClick={() => void runAction()}
        className="tono-tray-action"
        style={{
          flexShrink: 0,
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
          <TonoIcon name={action === 'retry' ? 'refresh' : 'power'} size={14} />
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
