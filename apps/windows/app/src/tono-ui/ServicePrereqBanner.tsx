import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoRepairService,
  tonoServicePrerequisites,
  type TonoServicePrerequisites,
} from '@/services/tono'
import { TONO_COLORS, tonoText } from '@/tono-ui/theme'

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

/// Says why nothing will work, before the user tries to connect and is told nothing useful.
///
/// TonoService is AutoStart and hard-depends on BFE. When a "network optimiser" switches BFE off,
/// Windows refuses to start TonoService and never retries, so a reboot does not help either. That
/// state used to surface only as "protected, not connected" with every diagnostic field reading
/// unknown — a customer spent an evening on it, and the answer was two service names.
export const ServicePrereqBanner = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const [state, setState] = useState<TonoServicePrerequisites | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [repairing, setRepairing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setState(await tonoServicePrerequisites())
    } catch {
      // A prerequisite check that cannot run must never itself become a banner; the connect
      // path still reports what it finds.
      setState(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Cheap, read-only, and the state changes out from under us when the user repairs by hand
    // or another program stops BFE mid-session.
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const repair = useLockFn(async () => {
    setRepairing(true)
    setError(null)
    try {
      await tonoRepairService()
      await refresh()
    } catch (cause) {
      setError(formatTonoActionError(cause, t))
    } finally {
      setRepairing(false)
    }
  })

  // Not registered at all is an install problem with its own flow; this banner is for a service
  // that exists and is not running.
  if (!state || !state.serviceRegistered || state.serviceRunning) return null

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
        background: hex(TONO_COLORS.error, dark ? 0.18 : 0.12),
        border: `1px solid ${hex(TONO_COLORS.error, 0.35)}`,
        color: text.primary,
      }}
    >
      <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 650 }}>
        {t('tono.servicePrereq.title')}
        <span
          style={{
            display: 'block',
            marginTop: 2,
            fontSize: 12,
            fontWeight: 500,
            color: text.secondary,
          }}
        >
          {state.bfeRunning
            ? t('tono.servicePrereq.generic')
            : t('tono.servicePrereq.bfe')}
        </span>
        {error && (
          <span
            style={{
              display: 'block',
              marginTop: 4,
              fontSize: 12,
              fontWeight: 500,
              color: TONO_COLORS.error,
            }}
          >
            {error}
          </span>
        )}
      </span>
      <button
        type="button"
        className="tono-button"
        disabled={repairing}
        onClick={() => void repair()}
        style={{
          minHeight: 30,
          padding: '5px 12px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 8,
          border: 'none',
          cursor: repairing ? 'default' : 'pointer',
          fontFamily: 'inherit',
          color: '#fff',
          background: TONO_COLORS.error,
        }}
      >
        {repairing
          ? t('tono.servicePrereq.repairing')
          : t('tono.servicePrereq.repair')}
      </button>
    </div>
  )
}
