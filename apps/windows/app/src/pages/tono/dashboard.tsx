import { useLockFn } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'

import { useTonoStatus } from '@/hooks/use-tono'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import {
  connectErrorSuggestsServerSwitch,
  connectRejectionNeedsServerChoice,
  formatTonoActionError,
  isEncryptedDnsFailure,
  formatTonoDiagnostics,
  tonoConnect,
  tonoDiagnosticsReport,
  tonoDisconnect,
  tonoRetryNow,
  tonoUploadDiagnostics,
} from '@/services/tono'
import { ConnectPill } from '@/tono-ui/ConnectPill'
import { GlassCard } from '@/tono-ui/GlassCard'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  TONO_COLORS,
  TONO_MONO_STACK,
  TONO_PAGE_LAYOUT,
  TONO_SPRING,
  tonoText,
} from '@/tono-ui/theme'
import { TonoConfirmDialog } from '@/tono-ui/TonoAccountCard'
import { OpenDnsSettingsButton } from '@/tono-ui/OpenDnsSettingsButton'
import { TonoNodeBadge } from '@/tono-ui/TonoNodeBadge'
import parseTraffic from '@/utils/parse-traffic'

import { ConnectProgressCard } from './connect-progress'
import {
  latencyColor,
  latencyLabelKey,
  latencyLabelVars,
  readNodeLatency,
} from './node-latency'
import { nodeCityParts, nodeCityTitleKey, nodeCode, nodeDisplayName } from './node-meta'

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

const CHECKLIST_STORAGE_KEY = 'tono.connectChecklistDismissed'

const ConnectChecklist = ({ dark }: { dark: boolean }) => {
  const { t } = useTranslation()
  const text = tonoText(dark)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(CHECKLIST_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  const items = [
    t('tono.dashboard.checklist.admin'),
    t('tono.dashboard.checklist.encryptedDns'),
    t('tono.dashboard.checklist.browserDns'),
    t('tono.dashboard.checklist.leakTest'),
  ]
  return (
    <GlassCard
      radius="var(--tono-radius-card)"
      padding={16}
      style={{ width: 520, maxWidth: '100%' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 650, color: text.primary }}>
          {t('tono.dashboard.checklist.title')}
        </span>
        <button
          type="button"
          className="tono-link"
          style={{ fontSize: 12, color: TONO_COLORS.accent, flexShrink: 0 }}
          onClick={() => {
            try {
              window.localStorage.setItem(CHECKLIST_STORAGE_KEY, '1')
            } catch {
              /* ignore quota */
            }
            setDismissed(true)
          }}
        >
          {t('tono.dashboard.checklist.dismiss')}
        </button>
      </div>
      <ol
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 12,
          lineHeight: 1.55,
          color: text.secondary,
        }}
      >
        {items.map((item) => (
          <li key={item} style={{ marginBottom: 4 }}>
            {item}
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 10 }}>
        <OpenDnsSettingsButton />
      </div>
    </GlassCard>
  )
}

const ActiveNodeCard = ({
  serverName,
  connected,
  exitOrg,
  exitLocation,
  exitDelayMs,
  tcpDelayMs,
}: {
  serverName: string
  connected: boolean
  exitOrg?: string | null
  exitLocation?: string | null
  exitDelayMs?: number | null
  tcpDelayMs?: number | null
}) => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const navigate = useNavigate()
  const [latencyState, setLatencyState] = useState(() => ({
    name: serverName,
    latency: readNodeLatency(serverName),
  }))

  // Re-read latency when the selected node changes: adjusting state during
  // render is the sanctioned alternative to a sync setState inside an effect.
  if (latencyState.name !== serverName) {
    setLatencyState({ name: serverName, latency: readNodeLatency(serverName) })
  }
  const reading =
    connected && exitDelayMs && exitDelayMs > 0
      ? { kind: 'exit' as const, ms: exitDelayMs }
      : tcpDelayMs && tcpDelayMs > 0
        ? { kind: 'tcp' as const, ms: tcpDelayMs }
        : latencyState.latency
          ? { kind: 'cached' as const, ms: latencyState.latency }
          : null
  const latency = reading?.ms ?? null

  return (
    <GlassCard
      radius="var(--tono-radius-card)"
      padding={0}
      style={{
        width: 520,
        maxWidth: '100%',
        overflow: 'hidden',
        animation: `tono-card-in 0.5s ${TONO_SPRING}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 16px 10px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.15,
            color: text.secondary,
          }}
        >
          {connected
            ? t('tono.node.activeServer')
            : t('tono.node.selectedServer')}
        </span>
        <button
          type="button"
          className="tono-link"
          onClick={() => navigate('/servers')}
          style={{
            minHeight: 30,
            padding: '5px 9px',
            fontSize: 12,
            fontWeight: 600,
            color: dark ? '#A9B7FF' : '#3453D5',
            background: hex(TONO_COLORS.accent, dark ? 0.12 : 0.08),
          }}
        >
          {t('tono.node.switch')}
        </button>
      </div>
      {connected && (exitOrg || exitLocation) && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            padding: '0 16px 10px',
            color: text.secondary,
            fontSize: 12,
          }}
        >
          <span>
            {t('tono.dashboard.info.operator')}: {exitOrg || '—'}
          </span>
          <span>
            {t('tono.dashboard.info.country')}: {exitLocation || '—'}
          </span>
        </div>
      )}

      <div style={{ padding: '0 10px 10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderRadius: 13,
            padding: '13px 15px',
            background: dark
              ? 'rgba(255,255,255,0.055)'
              : 'rgba(235,240,250,0.68)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(56,72,108,0.08)'}`,
          }}
        >
          <TonoNodeBadge size={36} city={nodeCityParts(serverName).city} />
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 650,
                color: text.primary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nodeCityTitleKey(serverName)
                ? t(nodeCityTitleKey(serverName)!)
                : nodeDisplayName(serverName)}
            </span>
            <span style={{ fontSize: 11, color: text.tertiary }}>
              {nodeCityParts(serverName).codename
                ? `${nodeCityParts(serverName).codename} · ${nodeCode(serverName)}`
                : `${t('tono.node.group')} · ${nodeCode(serverName)}`}
            </span>
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: TONO_MONO_STACK,
              borderRadius: 8,
              padding: '5px 9px',
              color:
                latency !== null
                  ? latencyColor(latency, reading?.kind ?? 'exit')
                  : text.tertiary,
              background:
                latency !== null
                  ? hex(latencyColor(latency, reading?.kind ?? 'exit'), 0.15)
                  : 'transparent',
            }}
          >
            {reading
              ? t(latencyLabelKey(reading.kind, reading.ms), latencyLabelVars(reading.ms))
              : '—'}
          </span>
        </div>
      </div>
    </GlassCard>
  )
}

const InfoItem = ({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) => {
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  return (
    <span
      style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 76 }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.2,
          color: text.tertiary,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: valueColor ?? text.primary,
          fontFamily: TONO_MONO_STACK,
        }}
      >
        {value}
      </span>
    </span>
  )
}

interface DashboardActionError {
  message: string
  retry: 'connect' | 'disconnect' | 'retryNow'
  suggestsSwitch: boolean
  encryptedDns: boolean
}

const DashboardPage = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const navigate = useNavigate()
  const { status, mutateTonoStatus } = useTonoStatus()
  const [actionError, setActionError] = useState<DashboardActionError | null>(
    null,
  )
  // Mirrors the Support page's phase machine. `tono_upload_diagnostics` documents itself as
  // "only ever called from an explicit user confirmation ... by design — this is a VPN", and
  // Support honours that with a dialog that enumerates what leaves the machine. This button
  // fired the same command straight from the click.
  const [sendingDiagnostics, setSendingDiagnostics] = useState(false)
  const [confirmingDiagnostics, setConfirmingDiagnostics] = useState(false)

  const handleCopyDetails = useLockFn(async () => {
    try {
      const text = formatTonoDiagnostics(await tonoDiagnosticsReport())
      await navigator.clipboard.writeText(text)
      showNotice.success('tono.progress.copied')
    } catch {
      showNotice.error('tono.progress.copyFailed')
    }
  })

  const handleSendDiagnostics = useLockFn(async () => {
    setSendingDiagnostics(true)
    try {
      const receipt = await tonoUploadDiagnostics()
      setActionError((current) =>
        current
          ? {
              ...current,
              message: `${current.message}\n${receipt.referenceCode}`,
            }
          : current,
      )
    } catch (error) {
      // Previously `.catch(() => setSendingDiagnostics(false))`: the label flipped back and
      // nothing else happened, so TONO_DIAG_UNREACHABLE — the expected outcome when the kill
      // switch is blocking, which is exactly when this button is on screen — was
      // indistinguishable from success.
      setActionError((current) =>
        current
          ? {
              ...current,
              message: `${current.message}\n${formatTonoActionError(error, t)}`,
            }
          : current,
      )
    } finally {
      // Closed on both outcomes: the reference code and the failure both land in the same
      // error box the user is already reading, and a dialog left open would cover it.
      setSendingDiagnostics(false)
      setConfirmingDiagnostics(false)
    }
  })

  const uiState = status?.uiState ?? 'notConnected'
  const connected = uiState === 'connected'
  const busy =
    uiState === 'connecting' ||
    uiState === 'disconnecting' ||
    uiState === 'protectedOffline'
  // Connect/protected-offline failures belong on the progress card. Showing
  // them here as well triples the same error (action box + steps + details).
  const showActionError =
    actionError != null &&
    uiState !== 'protectedOffline' &&
    uiState !== 'connecting'

  // A failed protected-offline attempt can reconnect on the backend's timer
  // without running one of this component's click handlers. Adjust the stale
  // error during render when that authoritative status arrives; the guarded
  // update runs once and avoids an extra effect render. A failed Disconnect is
  // deliberately retained because the status correctly remains connected.
  if (
    uiState === 'connected' &&
    actionError &&
    actionError.retry !== 'disconnect'
  ) {
    setActionError(null)
  }

  const {
    response: { data: traffic },
    live: trafficLive,
    refreshGetClashTraffic,
  } = useTrafficData({
    enabled: connected,
    generation: status?.controllerGeneration,
  })
  const [trafficWaited, setTrafficWaited] = useState(false)
  useEffect(() => {
    if (!connected || trafficLive) {
      setTrafficWaited(false)
      return
    }
    const timer = window.setTimeout(() => setTrafficWaited(true), 4_000)
    return () => window.clearTimeout(timer)
  }, [connected, trafficLive, status?.controllerGeneration])
  useEffect(() => {
    if (!trafficWaited || trafficLive) return
    // Back off rather than polling at 4s forever, and rebuild on a controller
    // restart: without the generation here, a poll could keep running against
    // the generation that just went away.
    let cancelled = false
    let attempt = 0
    let timer = 0
    const tick = () => {
      if (cancelled) return
      refreshGetClashTraffic()
      attempt += 1
      timer = window.setTimeout(tick, Math.min(4_000 * 2 ** (attempt - 1), 30_000))
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    trafficWaited,
    trafficLive,
    status?.controllerGeneration,
    refreshGetClashTraffic,
  ])

  const handleConnect = useLockFn(async () => {
    setActionError(null)
    try {
      await tonoConnect()
      await mutateTonoStatus()
    } catch (error) {
      // A rejection because no usable server is selected is not an error to
      // read — it is a navigation: land the user on the picker they need.
      // (The real-machine failure mode: with the picker never visited, every
      // connect click was silently rejected and looked like a dead button.)
      if (connectRejectionNeedsServerChoice(error)) {
        navigate('/servers')
        return
      }
      // `tono_connect` returns only after fail_connect and reconnect scheduling.
      // Read that settled backend snapshot now and store the retry owner with
      // the error; a later status push must not change which command Retry uses.
      let retry: DashboardActionError['retry'] = 'connect'
      try {
        const { data: failedStatus } = await mutateTonoStatus()
        if ((failedStatus?.uiState ?? status?.uiState) === 'protectedOffline') {
          retry = 'retryNow'
        }
      } catch {
        // Keep the original action error. The current snapshot is only a
        // fallback when the authoritative local status read itself failed.
        if (status?.uiState === 'protectedOffline') retry = 'retryNow'
      }
      setActionError({
        message: formatTonoActionError(error, t),
        retry,
        suggestsSwitch: connectErrorSuggestsServerSwitch(error),
        encryptedDns: isEncryptedDnsFailure(error),
      })
    }
  })

  // Releasing protection from the pill has the same consequence as the progress
  // card's 恢复正常网络 button, which has always confirmed first. One screen
  // offering both, with only one of them guarded, meant a mis-click could drop
  // fail-closed protection and let traffic out directly.
  const [confirmingRelease, setConfirmingRelease] = useState(false)

  const handleDisconnect = useLockFn(async () => {
    setActionError(null)
    try {
      await tonoDisconnect()
      await mutateTonoStatus()
    } catch (error) {
      setActionError({
        message: formatTonoActionError(error, t),
        retry: 'disconnect',
        suggestsSwitch: false,
        encryptedDns: false,
      })
    }
  })

  const handleRetryNow = useLockFn(async () => {
    setActionError(null)
    try {
      // Protected-offline retry owns a scheduled reconnect in the backend;
      // this command cancels that timer before starting the immediate attempt.
      await tonoRetryNow()
      await mutateTonoStatus()
    } catch (error) {
      setActionError({
        message: formatTonoActionError(error, t),
        retry: 'retryNow',
        suggestsSwitch: connectErrorSuggestsServerSwitch(error),
        encryptedDns: isEncryptedDnsFailure(error),
      })
    }
  })

  const retryFailedAction = () => {
    if (!actionError) return
    if (actionError.retry === 'disconnect') {
      void handleDisconnect()
    } else if (actionError.retry === 'retryNow') {
      void handleRetryNow()
    } else {
      void handleConnect()
    }
  }

  const [up, upUnit] = parseTraffic(traffic?.up ?? 0)
  const [down, downUnit] = parseTraffic(traffic?.down ?? 0)
  const connectHint = connected
    ? status?.directOverlay === 'skipped'
      ? t('tono.dashboard.directSkipped')
      : t('tono.dashboard.directOn')
    : t('tono.dashboard.taglineIdle')
  const selectedCity = status?.selectedServer
    ? nodeCityTitleKey(status.selectedServer)
      ? t(nodeCityTitleKey(status.selectedServer)!)
      : nodeDisplayName(status.selectedServer)
    : t('tono.dashboard.noServer')
  const protectionValue = selectedCity
  const protectionDetail = connectHint
  // Never present a stale 0 B/s as live throughput: that is the fallback
  // before the controller WebSocket has delivered a frame, not an idle tunnel.
  const trafficValue = !connected
    ? t('tono.dashboard.overview.idle')
    : !trafficLive
      ? t(
          trafficWaited
            ? 'tono.dashboard.overview.telemetryFailed'
            : 'tono.dashboard.overview.reading',
        )
      : `${down} ${downUnit}/s`
  const trafficDetail = !connected
    ? t('tono.dashboard.overview.noActiveRoute')
    : trafficLive
      ? `↑ ${up} ${upUnit}/s`
      : ''

  return (
    // Structural layout inline as well as in the stylesheet (see TonoSidebar):
    // without it a machine whose stylesheet never applied showed the connect
    // card jammed into the window's left edge.
    <div
      className="tono-page tono-dashboard"
      style={{ ...TONO_PAGE_LAYOUT, height: '100%', minHeight: 0, paddingTop: 18 }}
    >
      <PageHeader
        title={t('tono.dashboard.title')}
        subtitle={t('tono.dashboard.subtitle')}
      />
      {status?.catalogRequiresChoice && (
        <div
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}
        >
          <Link
            to="/servers"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: TONO_COLORS.protectedOffline,
              borderRadius: 10,
              padding: '8px 12px',
              background: hex(TONO_COLORS.protectedOffline, 0.12),
              textDecoration: 'none',
            }}
          >
            {t('tono.dashboard.catalogRequiresChoice')}
          </Link>
        </div>
      )}
      {status?.killSwitch?.last_error && (
        <div
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: TONO_COLORS.error,
              borderRadius: 10,
              padding: '8px 12px',
              background: hex(TONO_COLORS.error, 0.12),
            }}
          >
            {t('tono.dashboard.killSwitchError', {
              message: formatTonoActionError(status.killSwitch.last_error, t),
            })}{' '}
            <span style={{ opacity: 0.7 }}>
              {t('tono.dashboard.killSwitchErrorNote')}
            </span>
          </span>
        </div>
      )}
      {/* Center stack — status chip → connect → node → (progress only when busy) */}
      <div
        className="tono-dashboard__content"
        style={{
          flex: '1 1 auto',
          width: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: '24px 0',
        }}
      >
        <div style={{ transition: `all 0.5s ${TONO_SPRING}` }}>
          <ConnectPill
            uiState={uiState}
            stage={status?.stage}
            onConnect={handleConnect}
            onDisconnect={() => {
              if (uiState === 'protectedOffline') {
                setConfirmingRelease(true)
              } else {
                void handleDisconnect()
              }
            }}
          />
          <p
            style={{
              margin: '10px 0 0',
              maxWidth: 360,
              fontSize: 12,
              lineHeight: 1.5,
              textAlign: 'center',
              color: text.secondary,
            }}
          >
            {connectHint}
          </p>

        </div>
        {!connected && uiState === 'notConnected' && (
          <ConnectChecklist dark={dark} />
        )}
        {/* Actionable error under the primary control — includes a switch-server
            path when the exit itself is the likely problem. */}
        {showActionError && (
          <div
            role="alert"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              maxWidth: 480,
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              borderRadius: 14,
              padding: '12px 14px',
              background: hex(TONO_COLORS.error, dark ? 0.14 : 0.1),
              border: `1px solid ${hex(TONO_COLORS.error, 0.22)}`,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.2,
                color: dark ? '#FF8A84' : TONO_COLORS.error,
              }}
            >
              {t('tono.dashboard.whatFailed')}
            </span>
            <span
              data-testid="tono-action-error-message"
              style={{
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.45,
                color: dark ? '#FF8A84' : TONO_COLORS.error,
                textAlign: 'center',
                maxWidth: '100%',
                overflowWrap: 'anywhere',
              }}
            >
              {actionError.message}
            </span>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 8,
                maxWidth: '100%',
              }}
            >
              {actionError.encryptedDns && <OpenDnsSettingsButton accent />}
              <button
                type="button"
                className="tono-button"
                onClick={retryFailedAction}
                style={{
                  minHeight: 32,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 9,
                  border: 'none',
                  cursor: 'pointer',
                  color: '#fff',
                  background: TONO_COLORS.accent,
                }}
              >
                {t('tono.dashboard.errorRetry')}
              </button>
              <button
                type="button"
                className="tono-button"
                onClick={() => void handleCopyDetails()}
                style={{
                  minHeight: 32,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 9,
                  border: `1px solid ${hex(TONO_COLORS.accent, 0.35)}`,
                  cursor: 'pointer',
                  color: dark ? '#A9B7FF' : '#3453D5',
                  background: hex(TONO_COLORS.accent, dark ? 0.14 : 0.08),
                }}
              >
                {t('tono.dashboard.copyDetails')}
              </button>
              <button
                type="button"
                className="tono-button"
                disabled={sendingDiagnostics}
                onClick={() => setConfirmingDiagnostics(true)}
                style={{
                  minHeight: 32,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 9,
                  border: `1px solid ${hex(TONO_COLORS.accent, 0.35)}`,
                  cursor: 'pointer',
                  color: dark ? '#A9B7FF' : '#3453D5',
                  background: hex(TONO_COLORS.accent, dark ? 0.14 : 0.08),
                }}
              >
                {sendingDiagnostics
                  ? t('tono.progress.upload.uploading')
                  : t('tono.dashboard.errors.sendDiagnostics')}
              </button>
              {actionError.retry !== 'disconnect' &&
                actionError.suggestsSwitch && (
                  <button
                    type="button"
                    className="tono-button"
                    onClick={() => navigate('/servers')}
                    style={{
                      minHeight: 32,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 9,
                      border: `1px solid ${hex(TONO_COLORS.accent, 0.35)}`,
                      cursor: 'pointer',
                      color: dark ? '#A9B7FF' : '#3453D5',
                      background: hex(TONO_COLORS.accent, dark ? 0.14 : 0.08),
                    }}
                  >
                    {t('tono.dashboard.errorSwitchServer')}
                  </button>
                )}
            </div>
          </div>
        )}
        {/* Progress card self-hides when idle and no uncleared failure record. */}
        <ConnectProgressCard
          uiState={uiState}
          onRefreshStatus={mutateTonoStatus}
          onChooseRoute={() => navigate('/servers')}
        />
        {status?.selectedServer && (
          <ActiveNodeCard
            serverName={status.selectedServer}
            connected={connected}
            exitOrg={status.exitOrg}
            exitLocation={status.exitLocation}
            exitDelayMs={status.exitDelayMs}
            tcpDelayMs={status.tcpDelayMs}
          />
        )}
        {!status?.selectedServer && !busy && (
          <button
            type="button"
            className="tono-link"
            onClick={() => navigate('/servers')}
            style={{
              minHeight: 36,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 11,
              border: 'none',
              cursor: 'pointer',
              color: dark ? '#A9B7FF' : '#3453D5',
              background: hex(TONO_COLORS.accent, dark ? 0.14 : 0.1),
            }}
          >
            {t('tono.dashboard.pickServer')}
          </button>
        )}
      </div>

      {uiState !== 'connecting' &&
        uiState !== 'disconnecting' &&
        uiState !== 'protectedOffline' && (
          <div className="tono-stat-grid">
            <GlassCard radius="var(--tono-radius-card-sm)" padding={14}>
              <InfoItem
                label={t('tono.dashboard.server')}
                value={protectionValue}
              />
              <span
                style={{
                  display: 'block',
                  marginTop: 4,
                  fontSize: 11,
                  color: text.tertiary,
                }}
              >
                {protectionDetail}
              </span>
            </GlassCard>
            <GlassCard radius="var(--tono-radius-card-sm)" padding={14}>
              <InfoItem
                label={t('tono.dashboard.overview.serverPool')}
                value={selectedCity}
              />
              <span
                style={{
                  display: 'block',
                  marginTop: 4,
                  fontSize: 11,
                  color: text.tertiary,
                }}
              >
                {status?.catalogRevision != null
                  ? t('tono.nodes.catalogSynced')
                  : t('tono.dashboard.overview.refreshingCatalog')}
              </span>
            </GlassCard>
            <GlassCard radius="var(--tono-radius-card-sm)" padding={14}>
              <InfoItem
                label={t('tono.dashboard.overview.liveTraffic')}
                value={trafficValue}
              />
              <span
                style={{
                  display: 'block',
                  marginTop: 4,
                  fontSize: 11,
                  color: text.tertiary,
                }}
              >
                {trafficDetail}
              </span>
            </GlassCard>
          </div>
        )}
      {confirmingRelease && (
        <TonoConfirmDialog
          dark={dark}
          title={t('tono.progress.restoreConfirmTitle')}
          message={t('tono.progress.restoreConfirmMessage')}
          confirmLabel={t('tono.progress.restore')}
          cancelLabel={t('shared.actions.cancel')}
          onConfirm={() => {
            setConfirmingRelease(false)
            void handleDisconnect()
          }}
          onCancel={() => setConfirmingRelease(false)}
        />
      )}
      {confirmingDiagnostics && (
        <TonoConfirmDialog
          dark={dark}
          title={t('tono.dashboard.errors.sendDiagnostics')}
          message={t('tono.progress.upload.confirmMessage')}
          confirmLabel={t('shared.actions.confirm')}
          cancelLabel={t('shared.actions.cancel')}
          onConfirm={handleSendDiagnostics}
          onCancel={() => {
            if (!sendingDiagnostics) setConfirmingDiagnostics(false)
          }}
        />
      )}
    </div>
  )
}

export default DashboardPage
