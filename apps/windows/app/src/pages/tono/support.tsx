import { open as openUrl } from '@tauri-apps/plugin-shell'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  formatTonoDiagnostics,
  tonoAuditLogPath,
  tonoCheckTerminalEnv,
  tonoClearTerminalProxyEnv,
  tonoDiagnosticsReport,
  tonoUploadDiagnostics,
  type TonoDiagnosticsReport,
} from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { PageHeader } from '@/tono-ui/PageHeader'
import { SupportContact } from '@/tono-ui/SupportContact'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import { TonoConfirmDialog } from '@/tono-ui/TonoAccountCard'
import { TonoIcon } from '@/tono-ui/TonoIcon'

import { nodeCityTitleKey, nodeDisplayName } from './node-meta'

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`

const diagnosticsQueryKey = ['tonoDiagnosticsReport'] as const
const auditLogPathQueryKey = ['tonoAuditLogPath'] as const
const terminalEnvQueryKey = ['tonoTerminalEnv'] as const

type UploadPhase = 'idle' | 'confirming' | 'uploading' | 'sent'

const valueOrUnknown = (value: string | null) => value ?? '—'

const boolStatus = (
  value: boolean | null,
  enabled: string,
  disabled: string,
) => (value == null ? '—' : value ? enabled : disabled)

const protectionModeKey = (mode: string) => {
  switch (mode) {
    case 'locked':
      return 'tono.support.protection.locked' as const
    case 'blocked':
      return 'tono.support.protection.blocked' as const
    case 'bootstrap':
      return 'tono.support.protection.bootstrap' as const
    default:
      return null
  }
}

const protectionSummary = (
  report: TonoDiagnosticsReport,
  translate: (key: string) => string,
) => {
  if (report.killSwitchMode == null) return '—'
  const modeKey = protectionModeKey(report.killSwitchMode)
  const mode = modeKey ? translate(modeKey) : report.killSwitchMode
  const live = boolStatus(
    report.killSwitchLive,
    translate('tono.support.enabled'),
    translate('tono.support.disabled'),
  )
  return `${mode} · ${live}`
}

const SummaryRow = ({
  label,
  value,
  monospace = false,
}: {
  label: string
  value: string
  monospace?: boolean
}) => {
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 0.7fr) minmax(0, 1.3fr)',
        gap: 16,
        padding: '10px 0',
        borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(35,48,78,0.07)'}`,
      }}
    >
      <span style={{ fontSize: 12, color: text.secondary }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: text.primary,
          fontFamily: monospace ? TONO_MONO_STACK : undefined,
          overflowWrap: 'anywhere',
          userSelect: 'text',
        }}
      >
        {value}
      </span>
    </div>
  )
}

const SupportPage = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [referenceCode, setReferenceCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const {
    data: report,
    error: reportError,
    isLoading,
    refetch: refreshReport,
  } = useQuery({
    queryKey: diagnosticsQueryKey,
    queryFn: tonoDiagnosticsReport,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const { data: auditLogInfo, error: auditPathError } = useQuery({
    queryKey: auditLogPathQueryKey,
    queryFn: tonoAuditLogPath,
    retry: false,
  })

  const {
    data: terminalEnv,
    refetch: refetchTerminalEnv,
    isLoading: terminalEnvLoading,
    error: terminalEnvError,
  } = useQuery({
    queryKey: terminalEnvQueryKey,
    queryFn: tonoCheckTerminalEnv,
  })

  const [clearingEnv, setClearingEnv] = useState(false)
  const handleClearTerminalEnv = useLockFn(async () => {
    setClearingEnv(true)
    try {
      await tonoClearTerminalProxyEnv()
      await refetchTerminalEnv()
      showNotice.success(t('tono.support.terminalEnv.clearSuccess'))
    } catch (err) {
      showNotice.error(formatTonoActionError(err, t))
    } finally {
      setClearingEnv(false)
    }
  })

  const handleCopyDetails = useLockFn(async () => {
    try {
      const { data } = await refreshReport()
      if (!data) throw new Error('Diagnostics report unavailable')
      await navigator.clipboard.writeText(formatTonoDiagnostics(data))
      showNotice.success('tono.support.detailsCopied')
    } catch (error) {
      console.warn('[Support] copy diagnostics failed:', error)
      showNotice.error('tono.support.copyFailed')
    }
  })

  const handleCopyAuditPath = useLockFn(async () => {
    if (!auditLogInfo?.path) return
    try {
      await navigator.clipboard.writeText(auditLogInfo.path)
      showNotice.success('tono.support.auditPathCopied')
    } catch (error) {
      console.warn('[Support] copy audit path failed:', error)
      showNotice.error('tono.support.copyFailed')
    }
  })

  const handleUpload = useLockFn(async () => {
    setUploadPhase('uploading')
    setUploadError(null)
    try {
      const receipt = await tonoUploadDiagnostics()
      setReferenceCode(receipt.referenceCode)
      setUploadPhase('sent')
    } catch (error) {
      setUploadError(formatTonoActionError(error, t))
      setUploadPhase('confirming')
    }
  })

  const handleCopyCode = useLockFn(async () => {
    if (!referenceCode) return
    try {
      await navigator.clipboard.writeText(referenceCode)
      setCodeCopied(true)
    } catch (error) {
      console.warn('[Support] copy reference code failed:', error)
      showNotice.error('tono.support.copyFailed')
    }
  })

  // DNS warning markers (TONO_DNS_UNVERIFIED / TONO_DNS_RESTORE_DEGRADED) ride in
  // dnsLastError by design but are not failures — the tunnel stays protected. Showing
  // them under "last error" panics users for a healthy connection, so they get their
  // own row. Mirrors DNS_WARNING_MARKERS in src-tauri/src/tono/connection.rs.
  const dnsWarningMarkers = ['TONO_DNS_UNVERIFIED', 'TONO_DNS_RESTORE_DEGRADED']
  const dnsWarning =
    report?.dnsLastError &&
    dnsWarningMarkers.some((marker) => report.dnsLastError!.includes(marker))
      ? report.dnsLastError
      : null
  const rawLastError = report
    ? (report.error ??
      report.killSwitchLastError ??
      (dnsWarning ? null : report.dnsLastError))
    : null
  const lastError = report
    ? rawLastError
      ? formatTonoActionError(rawLastError, t)
      : t('tono.support.none')
    : '—'
  const secondaryBackground = dark
    ? 'rgba(255,255,255,0.07)'
    : 'rgba(235,240,250,0.72)'
  const secondaryBorder = `1px solid ${
    dark ? 'rgba(255,255,255,0.1)' : 'rgba(56,72,108,0.1)'
  }`
  const buttonStyle = {
    padding: '9px 14px',
    fontSize: 12,
    color: text.primary,
    background: secondaryBackground,
    border: secondaryBorder,
  } as const

  return (
    <div className="tono-page">
      <PageHeader
        title={t('tono.support.title')}
        subtitle={t('tono.support.subtitle')}
        trailing={
          <button
            type="button"
            className="tono-button"
            onClick={() => void refreshReport()}
            disabled={isLoading}
            style={buttonStyle}
          >
            <TonoIcon name="refresh" size={15} />
            {t('tono.support.refresh')}
          </button>
        }
      />

      <div style={{ display: 'grid', gap: 14, maxWidth: 680 }}>
        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 8px', fontSize: 14, color: text.primary }}>
            {t('tono.support.contact.copyMessage')}
          </h2>
          <SupportContact extra={rawLastError ? lastError : undefined} />
        </GlassCard>
        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 6px', fontSize: 14, color: text.primary }}>
            {t('tono.support.summary.title')}
          </h2>
          {reportError && (
            <p role="alert" style={{ fontSize: 12, color: TONO_COLORS.error }}>
              {t('tono.support.loadFailed')}
            </p>
          )}
          <SummaryRow
            label={t('tono.support.summary.app')}
            value={
              report ? `Tono ${report.appVersion} · ${report.osVersion}` : '—'
            }
          />
          <SummaryRow
            label={t('tono.support.summary.service')}
            value={
              report
                ? `${valueOrUnknown(report.serviceProtocol)}${report.serviceBuild ? ` · ${report.serviceBuild}` : ''}`
                : '—'
            }
          />
          <SummaryRow
            label={t('tono.support.summary.protection')}
            value={report ? protectionSummary(report, t) : '—'}
          />
          <SummaryRow
            label={t('tono.support.summary.dns')}
            value={
              report
                ? boolStatus(
                    report.dnsEnabled,
                    t('tono.support.enabled'),
                    t('tono.support.disabled'),
                  )
                : '—'
            }
          />
          <SummaryRow
            label={t('tono.support.summary.node')}
            value={
              report?.selectedServer
                ? nodeCityTitleKey(report.selectedServer)
                  ? t(nodeCityTitleKey(report.selectedServer)!)
                  : nodeDisplayName(report.selectedServer)
                : '—'
            }
          />
          <SummaryRow
            label={t('tono.support.summary.lastError')}
            value={lastError}
            monospace
          />
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}
          >
            <button
              type="button"
              className="tono-button"
              disabled={!report}
              onClick={() => {
                if (!report) return
                void navigator.clipboard
                  .writeText(`Tono ${report.appVersion} · ${report.osVersion}`)
                  .then(() => showNotice.success('tono.support.detailsCopied'))
                  .catch(() => showNotice.error('tono.support.copyFailed'))
              }}
              style={buttonStyle}
            >
              {t('tono.support.webrtc.copyVersion')}
            </button>
          </div>
          {dnsWarning && (
            <SummaryRow
              label={t('tono.support.summary.lastWarning')}
              value={dnsWarning}
              monospace
            />
          )}
        </GlassCard>

        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 6px', fontSize: 14, color: text.primary }}>
            {t('tono.support.audit.title')}
          </h2>
          <p
            style={{ margin: '0 0 12px', fontSize: 12, color: text.secondary }}
          >
            {t('tono.support.audit.description')}
          </p>
          {auditPathError && (
            <p role="alert" style={{ fontSize: 12, color: TONO_COLORS.error }}>
              {t('tono.support.audit.loadFailed')}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code
              data-testid="tono-support-audit-path"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '9px 11px',
                borderRadius: 9,
                fontSize: 11,
                color: text.primary,
                background: secondaryBackground,
                overflowWrap: 'anywhere',
                userSelect: 'text',
              }}
            >
              {auditLogInfo?.path ?? '—'}
            </code>
            <button
              type="button"
              className="tono-button"
              aria-label={t('tono.support.audit.copyPath')}
              disabled={!auditLogInfo?.path}
              onClick={handleCopyAuditPath}
              style={buttonStyle}
            >
              <TonoIcon name="copy" size={15} />
              {t('tono.support.audit.copyPath')}
            </button>
          </div>
        </GlassCard>

        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 14, color: text.primary }}>
              {t('tono.support.terminalEnv.title')}
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 8,
                background: terminalEnvLoading
                  ? hex(TONO_COLORS.gray, 0.12)
                  : terminalEnvError || terminalEnv == null
                    ? hex(TONO_COLORS.error, 0.12)
                    : terminalEnv.hasConflict
                      ? hex(TONO_COLORS.error, 0.12)
                      : hex(TONO_COLORS.latencyGood, 0.12),
                color: terminalEnvLoading
                  ? TONO_COLORS.gray
                  : terminalEnvError || terminalEnv == null
                    ? TONO_COLORS.error
                    : terminalEnv.hasConflict
                      ? TONO_COLORS.error
                      : TONO_COLORS.latencyGood,
              }}
            >
              {terminalEnvLoading
                ? t('tono.support.terminalEnv.checking')
                : terminalEnvError || terminalEnv == null
                  ? t('tono.support.terminalEnv.checkFailed')
                  : terminalEnv.hasConflict
                    ? t('tono.support.terminalEnv.conflictDetected')
                    : t('tono.support.terminalEnv.ready')}
            </span>
          </div>
          <p
            style={{ margin: '0 0 12px', fontSize: 12, color: text.secondary }}
          >
            {terminalEnvLoading
              ? t('tono.support.terminalEnv.checkingDesc')
              : terminalEnvError || terminalEnv == null
                ? t('tono.support.terminalEnv.checkFailedDesc')
                : terminalEnv.hasConflict
                  ? t('tono.support.terminalEnv.conflictDesc')
                  : t('tono.support.terminalEnv.readyDesc')}
          </p>

          {terminalEnv?.hasConflict && terminalEnv.entries.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: secondaryBackground,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {terminalEnv.entries.map((entry) => (
                <div
                  key={`${entry.key}-${entry.source}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    fontFamily: TONO_MONO_STACK,
                  }}
                >
                  <span style={{ fontWeight: 600, color: TONO_COLORS.error }}>
                    {entry.key}={entry.value}
                  </span>
                  <span style={{ color: text.tertiary }}>{entry.source}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {terminalEnv?.hasConflict && (
              <button
                type="button"
                className="tono-button"
                disabled={clearingEnv}
                onClick={handleClearTerminalEnv}
                style={{
                  ...buttonStyle,
                  background: hex(TONO_COLORS.error, dark ? 0.16 : 0.1),
                  color: dark ? '#FF8A84' : TONO_COLORS.error,
                  borderColor: hex(TONO_COLORS.error, 0.3),
                }}
              >
                {clearingEnv
                  ? t('tono.support.terminalEnv.clearing')
                  : t('tono.support.terminalEnv.clearAction')}
              </button>
            )}
            <button
              type="button"
              className="tono-button"
              disabled={terminalEnvLoading}
              onClick={() => void refetchTerminalEnv()}
              style={buttonStyle}
            >
              {t('tono.support.terminalEnv.recheck')}
            </button>
          </div>
        </GlassCard>

        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 6px', fontSize: 14, color: text.primary }}>
            {t('tono.support.webrtc.title')}
          </h2>
          <p
            style={{ margin: '0 0 12px', fontSize: 12, color: text.secondary }}
          >
            {t('tono.support.webrtc.description')}
          </p>
          <button
            type="button"
            className="tono-button"
            onClick={() => {
              void openUrl('https://ip.cx/webrtc').catch((error) => {
                console.warn('[Support] open WebRTC check failed:', error)
                showNotice.error('tono.support.copyFailed')
              })
            }}
            style={buttonStyle}
          >
            {t('tono.support.webrtc.open')}
          </button>
        </GlassCard>

        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 6px', fontSize: 14, color: text.primary }}>
            {t('tono.support.diagnostics.title')}
          </h2>
          <p
            style={{ margin: '0 0 14px', fontSize: 12, color: text.secondary }}
          >
            {t('tono.support.diagnostics.description')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="tono-button"
              onClick={handleCopyDetails}
              disabled={!report}
              style={buttonStyle}
            >
              {t('tono.progress.copyDetails')}
            </button>
            {referenceCode == null && (
              <button
                type="button"
                className="tono-button"
                data-testid="tono-support-upload-diagnostics"
                onClick={() => {
                  setUploadError(null)
                  setUploadPhase('confirming')
                }}
                disabled={uploadPhase === 'uploading'}
                style={{
                  ...buttonStyle,
                  opacity: uploadPhase === 'uploading' ? 0.6 : 1,
                }}
              >
                {uploadPhase === 'uploading'
                  ? t('tono.progress.upload.uploading')
                  : t('tono.progress.upload.action')}
              </button>
            )}
          </div>

          {referenceCode != null && (
            <div
              data-testid="tono-support-upload-reference"
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: `${TONO_COLORS.latencyGood}1F`,
              }}
            >
              <div
                style={{ fontSize: 11, color: text.secondary, marginBottom: 6 }}
              >
                {t('tono.progress.upload.successHint')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    flex: 1,
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: 1,
                    fontFamily: TONO_MONO_STACK,
                    color: text.primary,
                    userSelect: 'text',
                  }}
                >
                  {referenceCode}
                </code>
                <button
                  type="button"
                  className="tono-button"
                  onClick={handleCopyCode}
                  style={buttonStyle}
                >
                  {codeCopied
                    ? t('tono.progress.upload.codeCopied')
                    : t('tono.progress.upload.copyCode')}
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {(uploadPhase === 'confirming' || uploadPhase === 'uploading') && (
        <TonoConfirmDialog
          dark={dark}
          title={t('tono.progress.upload.confirmTitle')}
          message={t('tono.progress.upload.confirmMessage')}
          error={uploadError}
          confirmLabel={
            uploadPhase === 'uploading'
              ? t('tono.progress.upload.uploading')
              : t('tono.progress.upload.confirmSend')
          }
          cancelLabel={t('shared.actions.cancel')}
          onConfirm={handleUpload}
          onCancel={() => {
            if (uploadPhase !== 'uploading') setUploadPhase('idle')
          }}
        />
      )}
    </div>
  )
}

export default SupportPage
