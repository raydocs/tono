import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { useTonoStatus } from '@/hooks/use-tono'

import { resolveTonoGuard } from './tono-guard'

/**
 * Layout-level Tono auth guard: redirects and the loading placeholder live here
 * so `_layout.tsx` only decides what the chrome looks like per route.
 */
export const TonoAuthGuard = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation()
  const location = useLocation()
  const { status } = useTonoStatus()
  const action = resolveTonoGuard(status, location.pathname)

  if (action === 'loading') {
    return (
      <div
        role="status"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p>{t('tono.login.restoringSession')}</p>
      </div>
    )
  }

  if (action === 'toLogin') {
    return <Navigate to="/login" replace />
  }

  if (action === 'toHome') {
    return <Navigate to="/" replace />
  }

  return children
}
