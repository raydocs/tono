import { useLockFn } from 'ahooks'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoPrepareSupportReport,
  tonoUploadDiagnostics,
  type TonoDiagnosticsReceipt,
  type TonoPreparedSupportReport,
} from '@/services/tono'

import { TONO_COLORS, TONO_MONO_STACK, tonoText } from './theme'
import { TonoConfirmDialog } from './TonoAccountCard'

/** Shared by Support and connection failures: local frozen preview → consent → receipt. */
export const SupportReportAction = ({
  testIdPrefix = 'tono',
  style,
}: {
  testIdPrefix?: string
  style?: CSSProperties
}) => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const [phase, setPhase] = useState<
    'idle' | 'preparing' | 'confirming' | 'uploading'
  >('idle')
  const [preview, setPreview] = useState<TonoPreparedSupportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{
    receipt: TonoDiagnosticsReceipt
    preview: TonoPreparedSupportReport
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const busy = phase === 'preparing' || phase === 'uploading'

  const prepare = useLockFn(async () => {
    setPhase('preparing')
    setPreview(null)
    setError(null)
    try {
      setPreview(await tonoPrepareSupportReport())
      setPhase('confirming')
    } catch {
      setError(t('tono.experience.prepareFailed'))
      setPhase('idle')
    }
  })

  const upload = useLockFn(async () => {
    if (!preview) return
    setPhase('uploading')
    setError(null)
    try {
      const receipt = await tonoUploadDiagnostics(preview.previewId)
      setSent({ receipt, preview })
      setPreview(null)
      setPhase('idle')
    } catch (cause) {
      // Dispatch consumes the backend preview, even on an ambiguous failure. Do not
      // silently rebuild/replay it: another send needs another reviewed snapshot.
      setPreview(null)
      setError(formatTonoActionError(cause, t))
      setPhase('confirming')
    }
  })

  const copy = useLockFn(async () => {
    if (!sent) return
    try {
      await navigator.clipboard.writeText(sent.receipt.referenceCode)
      setCopied(true)
    } catch {
      showNotice.error('tono.progress.copyFailed')
    }
  })

  const buttonStyle: CSSProperties = {
    padding: '9px 14px',
    fontSize: 12,
    color: text.primary,
    background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(235,240,250,0.72)',
    border: '1px solid var(--tono-surface-card-border)',
    ...style,
  }

  if (sent)
    return (
      <div
        data-testid={`${testIdPrefix}-upload-reference`}
        style={{
          width: '100%',
          padding: 12,
          borderRadius: 10,
          background: `${TONO_COLORS.latencyGood}1F`,
        }}
      >
        <p style={{ margin: '0 0 8px', fontSize: 12, color: text.secondary }}>
          {t('tono.progress.upload.successHint')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code
            style={{
              flex: 1,
              fontFamily: TONO_MONO_STACK,
              fontSize: 16,
              color: text.primary,
              userSelect: 'text',
            }}
          >
            {sent.receipt.referenceCode}
          </code>
          <button
            type="button"
            className="tono-button"
            style={buttonStyle}
            onClick={copy}
          >
            {t(
              copied
                ? 'tono.progress.upload.codeCopied'
                : 'tono.progress.upload.copyCode',
            )}
          </button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: text.secondary }}>
          {t('tono.experience.receiptTime', {
            time:
              sent.receipt.receivedAt == null
                ? t('tono.experience.state.unknown')
                : new Date(sent.receipt.receivedAt * 1000).toLocaleString(),
          })}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: text.secondary }}>
          {t('tono.experience.receiptContext', {
            time: new Date(sent.preview.report.reportedAtMs).toLocaleString(),
            version: sent.preview.report.appVersion,
            revision: sent.preview.report.catalogRevision ?? '—',
          })}
        </p>
      </div>
    )

  return (
    <>
      <button
        type="button"
        className="tono-button"
        data-testid={`${testIdPrefix}-upload-diagnostics`}
        disabled={busy}
        aria-busy={busy}
        onClick={prepare}
        style={buttonStyle}
      >
        {t(
          phase === 'preparing'
            ? 'tono.experience.preparing'
            : phase === 'uploading'
              ? 'tono.progress.upload.uploading'
              : 'tono.progress.upload.action',
        )}
      </button>
      {phase === 'idle' && error && (
        <p
          role="alert"
          style={{
            width: '100%',
            fontSize: 12,
            color: 'var(--tono-text-error)',
          }}
        >
          {error}
        </p>
      )}
      {(phase === 'confirming' || phase === 'uploading') && (
        <TonoConfirmDialog
          dark={dark}
          title={t('tono.progress.upload.confirmTitle')}
          message={t('tono.progress.upload.confirmMessage')}
          error={error}
          busy={busy}
          confirmLabel={t(
            phase === 'uploading'
              ? 'tono.progress.upload.uploading'
              : preview
                ? 'tono.progress.upload.confirmSend'
                : 'tono.experience.retryPreview',
          )}
          cancelLabel={t('shared.actions.cancel')}
          onConfirm={preview ? upload : prepare}
          onCancel={() => {
            if (!busy) {
              setPhase('idle')
              setPreview(null)
              setError(null)
            }
          }}
        >
          {preview && (
            <>
              <h3 style={{ fontSize: 13, margin: '8px 0' }}>
                {t('tono.experience.preview')}
              </h3>
              <p style={{ fontSize: 12, color: text.secondary }}>
                {t('tono.experience.previewHint')}
              </p>
              <pre
                tabIndex={0}
                data-testid="tono-support-preview"
                aria-label={t('tono.experience.preview')}
                style={{
                  maxHeight: 230,
                  overflow: 'auto',
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 11,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  userSelect: 'text',
                  color: text.primary,
                  background: dark ? 'rgba(0,0,0,0.2)' : 'rgba(35,48,78,0.04)',
                }}
              >
                {JSON.stringify(preview.report, null, 2)}
              </pre>
            </>
          )}
        </TonoConfirmDialog>
      )}
    </>
  )
}
