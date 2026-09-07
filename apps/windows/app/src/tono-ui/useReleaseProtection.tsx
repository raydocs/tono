import { useLockFn } from 'ahooks'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useThemeMode } from '@/services/states'
import { formatTonoActionError, tonoDisconnect } from '@/services/tono'

import { TonoConfirmDialog } from './TonoAccountCard'

/**
 * Confirm before releasing fail-closed protection. The global banner, dashboard
 * pill, and connect-progress card must share this so a mis-click cannot drop
 * the barrier silently.
 */
export const useReleaseProtection = (
  mutateStatus: () => Promise<unknown>,
): { requestRelease: () => void; dialog: ReactNode } => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestRelease = () => {
    setError(null)
    setOpen(true)
  }

  const confirm = useLockFn(async () => {
    setError(null)
    try {
      await tonoDisconnect()
      await mutateStatus()
      setOpen(false)
    } catch (cause) {
      setError(formatTonoActionError(cause, t))
    }
  })

  const dialog = open ? (
    <TonoConfirmDialog
      dark={dark}
      title={t('tono.progress.restoreConfirmTitle')}
      message={t('tono.progress.restoreConfirmMessage')}
      error={error}
      confirmLabel={t('tono.progress.restore')}
      cancelLabel={t('shared.actions.cancel')}
      onConfirm={() => void confirm()}
      onCancel={() => {
        setOpen(false)
        setError(null)
      }}
    />
  ) : null

  return { requestRelease, dialog }
}
