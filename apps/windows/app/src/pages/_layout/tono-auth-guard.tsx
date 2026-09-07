import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { useTonoStatus } from '@/hooks/use-tono'
import { restartApp } from '@/services/cmds'
import { TONO_COLORS } from '@/tono-ui/theme'
import { TonoLogo } from '@/tono-ui/TonoLogo'
import { useReleaseProtection } from '@/tono-ui/useReleaseProtection'

import { resolveTonoGuard } from './tono-guard'

const RESTORE_ESCAPE_MS = 8000

const RestoringSessionScreen = ({
  onRefreshStatus,
}: {
  onRefreshStatus: () => Promise<unknown>
}) => {
  const { t } = useTranslation()
  const { requestRelease, dialog: releaseDialog } =
    useReleaseProtection(onRefreshStatus)
  const [showEscape, setShowEscape] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowEscape(true),
      RESTORE_ESCAPE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <TonoLogo connected={false} size={56} />
      <span
        aria-hidden
        className="tono-spin"
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `1.5px solid ${TONO_COLORS.accent}59`,
          borderTopColor: TONO_COLORS.accent,
        }}
      />
      <p role="status" style={{ margin: 0, fontSize: 14 }}>
        {t('tono.login.restoringSession')}
      </p>
      {showEscape && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            marginTop: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, opacity: 0.78 }}>
            {t('tono.login.stillWaiting')}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <button
              type="button"
              className="tono-button"
              onClick={requestRelease}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: TONO_COLORS.protectedOffline,
              }}
            >
              {t('tono.login.restoreInternet')}
            </button>
            <button
              type="button"
              className="tono-button"
              onClick={() => void restartApp()}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {t('tono.login.restartTono')}
            </button>
          </div>
        </div>
      )}
      {releaseDialog}
    </div>
  )
}

/**
 * Layout-level Tono auth guard: redirects and the loading placeholder live here
 * so `_layout.tsx` only decides what the chrome looks like per route.
 */
export const TonoAuthGuard = ({ children }: { children: ReactNode }) => {
  const location = useLocation()
  const { status, mutateTonoStatus } = useTonoStatus()
  const action = resolveTonoGuard(status, location.pathname)

  if (action === 'loading') {
    return <RestoringSessionScreen onRefreshStatus={mutateTonoStatus} />
  }

  if (action === 'toLogin') {
    return <Navigate to="/login" replace />
  }

  if (action === 'toHome') {
    return <Navigate to="/" replace />
  }

  return children
}
