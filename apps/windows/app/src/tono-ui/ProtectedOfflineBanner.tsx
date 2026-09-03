import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { useTonoStatus } from '@/hooks/use-tono'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoDisconnect,
  tonoRetryNow,
} from '@/services/tono'
import { TONO_COLORS, tonoText } from '@/tono-ui/theme'

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

export const ProtectedOfflineBanner = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const navigate = useNavigate()
  const { status, mutateTonoStatus } = useTonoStatus()
  // Both actions used to fail into console.warn only, so pressing 重试 or
  // 恢复正常网络 while the Service was unavailable looked like a dead button.
  // TrayPanel already surfaces the same formatted error; this matches it.
  const [actionError, setActionError] = useState<string | null>(null)
  const retry = useLockFn(async () => {
    setActionError(null)
    try {
      await tonoRetryNow()
      await mutateTonoStatus()
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })
  const restore = useLockFn(async () => {
    setActionError(null)
    try {
      await tonoDisconnect()
      await mutateTonoStatus()
    } catch (error) {
      setActionError(formatTonoActionError(error, t))
    }
  })

  if (status?.uiState !== 'protectedOffline') return null

  const button = {
    minHeight: 30,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer' as const,
    fontFamily: 'inherit',
  }

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        margin: '10px 16px 0',
        padding: '10px 12px',
        borderRadius: 12,
        background: hex(TONO_COLORS.protectedOffline, dark ? 0.18 : 0.14),
        border: `1px solid ${hex(TONO_COLORS.protectedOffline, 0.35)}`,
        color: text.primary,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: TONO_COLORS.protectedOffline,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 160, fontSize: 13, fontWeight: 650 }}>
        {t('tono.dashboard.status.offline')}
        <span
          style={{
            display: 'block',
            marginTop: 2,
            fontSize: 12,
            fontWeight: 500,
            color: text.secondary,
          }}
        >
          {t('tono.dashboard.protectedOfflineDescription')}
        </span>
        {actionError && (
          <span
            style={{
              display: 'block',
              marginTop: 4,
              fontSize: 12,
              fontWeight: 500,
              color: TONO_COLORS.error,
            }}
          >
            {actionError}
          </span>
        )}
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="tono-button"
          onClick={() => void retry()}
          style={{
            ...button,
            color: '#fff',
            background: TONO_COLORS.protectedOffline,
          }}
        >
          {t('tono.tray.retry')}
        </button>
        <button
          type="button"
          className="tono-button"
          onClick={() => void restore()}
          style={{
            ...button,
            color: text.primary,
            background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(20,22,30,0.08)',
          }}
        >
          {t('tono.progress.restore')}
        </button>
        <button
          type="button"
          className="tono-button"
          onClick={() => navigate('/servers')}
          style={{
            ...button,
            color: text.primary,
            background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(20,22,30,0.08)',
          }}
        >
          {t('tono.dashboard.errorSwitchServer')}
        </button>
      </span>
    </div>
  )
}
