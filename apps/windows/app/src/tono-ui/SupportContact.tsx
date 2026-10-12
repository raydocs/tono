import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTonoStatus } from '@/hooks/use-tono'
import { useThemeMode } from '@/services/states'
import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { AUTH_ERROR_CODES } from '@/tono-ui/auth-diagnostic-codes'
import { tonoText } from '@/tono-ui/theme'
import { version } from '@root/package.json'

// Only these existing diagnostic labels/enums cross the clipboard boundary.
// No arbitrary error, email, node name, address, path or URL is copied.
const safeDiagnosticLine = (line: string) => {
  if (line.startsWith('Error code: ')) {
    const code = line.slice('Error code: '.length)
    return code === '(none)' || AUTH_ERROR_CODES.has(code)
  }
  return /^(?:Auth stage: (?:send-code|verify-code)|Recovery cause: (?:relaysUnreachable|network|clock|interception|captive|localConflict|service|localStore)|Routes: Tono relays|Relay [1-3]: (?:dns|connect|tls|timeout|other)|Paths: (?:system_dns|pinned|relay)\[\d{1,9}ms (?:dns|connect|tls|timeout|other)\](?:; (?:system_dns|pinned|relay)\[\d{1,9}ms (?:dns|connect|tls|timeout|other)\]){0,2}|Transport: (?:(?:dns|connect|tls|timeout|other)|(?:pinned|system-dns|relay)=(?:dns|connect|tls|timeout|other)(?:, (?:pinned|system-dns|relay)=(?:dns|connect|tls|timeout|other))*))$/.test(
    line,
  )
}

export const SupportContact = ({
  extra,
  compact = false,
  contact = false,
}: {
  extra?: string
  compact?: boolean
  contact?: boolean
}) => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)
  const [manualText, setManualText] = useState('')

  const copy = useLockFn(async () => {
    // Collect only on the click. Do not read the existing clipboard or upload.
    const uiState = status?.uiState
    const message = [
      `Tono ${version}`,
      uiState &&
      /^(?:notConnected|connecting|connected|protectedOffline|disconnecting)$/.test(
        uiState,
      )
        ? `status ${uiState}`
        : null,
      ...(extra?.split('\n').filter(safeDiagnosticLine) ?? []),
    ]
      .filter(Boolean)
      .join('\n')
    setResult(null)
    setManualText('')
    try {
      await navigator.clipboard.writeText(message)
      setResult('copied')
    } catch {
      setManualText(message)
      setResult('failed')
    }
  })

  const button = (
    <button
      type="button"
      // The legacy action fill is violet; the sea uses its own quiet pill.
      className={newAppearance ? 'sea-button' : 'tono-button tono-action'}
      data-variant={newAppearance ? 'text' : undefined}
      onClick={() => void copy()}
      style={{
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        ...(contact
          ? {
              color: text.secondary,
              fontWeight: 400,
              background: 'transparent',
              borderColor: 'transparent',
            }
          : {}),
      }}
    >
      {t(
        contact
          ? 'tono.support.contact.finalAction'
          : 'tono.support.contact.copyMessage',
      )}
    </button>
  )
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: compact ? 'flex-start' : 'center',
        maxWidth: '100%',
      }}
    >
      {!compact && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.45,
            color: text.secondary,
            textAlign: 'center',
          }}
        >
          {t('tono.support.contact.description')}
        </p>
      )}
      {button}
      {result === 'copied' && (
        <span role="status" style={{ fontSize: 12 }}>
          {t('tono.support.contact.copied')}
        </span>
      )}
      {result === 'failed' && (
        <>
          <span role="alert" style={{ fontSize: 12 }}>
            {t('tono.support.contact.copyFailed')}
          </span>
          <details style={{ fontSize: 12, width: '100%' }}>
            <summary>{t('tono.support.contact.manualCopy')}</summary>
            <textarea
              readOnly
              aria-label={t('tono.support.contact.manualCopy')}
              value={manualText}
              rows={4}
              onFocus={(event) => event.currentTarget.select()}
              style={{ boxSizing: 'border-box', width: '100%', marginTop: 8 }}
            />
          </details>
        </>
      )}
    </div>
  )
}
