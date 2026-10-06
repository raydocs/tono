import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { TonoAccount } from '@/services/tono'
import parseTraffic from '@/utils/parse-traffic'

import './sea-account.css'

/** Presentation only. Account/device scope and all irreversible actions stay in TonoAccountCard. */
export const SeaAccount = ({
  account,
  devices,
  deviceCount,
  onSignOut,
  dialogs,
}: {
  account: TonoAccount | null | undefined
  devices: ReactNode
  deviceCount: number
  onSignOut: () => void
  dialogs: ReactNode
}) => {
  const { t } = useTranslation()
  const usage = account?.usageBytes,
    quota = account?.quotaBytes
  const used = usage == null ? null : parseTraffic(Math.max(0, usage)).join(' ')
  const limit =
    quota == null ? null : parseTraffic(Math.max(0, quota)).join(' ')
  return (
    <div className="sea-panel sea-account">
      <div className="sea-account-fact">
        <span>{t('tono.account.email')}</span>
        <strong>{account?.email ?? '—'}</strong>
      </div>
      <div className="sea-account-fact">
        <span>{t('tono.account.plan')}</span>
        <span>
          {account ? account.plan || 'Tono' : '—'}
          {account && ' · '}
          {account &&
            (account.expiresAt != null
              ? dayjs(account.expiresAt * 1000).format('YYYY-MM-DD')
              : t('tono.account.noExpiry'))}
        </span>
      </div>
      {used !== null && limit !== null && (
        <div className="sea-account-usage">
          <div>
            <span>{t('tono.account.usage')}</span>
            <span>{t('tono.account.usageOf', { used, quota: limit })}</span>
          </div>
          {quota != null && quota > 0 && (
            <progress
              value={Math.max(0, usage ?? 0)}
              max={quota}
              aria-label={t('tono.account.usage')}
            />
          )}
        </div>
      )}
      <h2>
        {t('tono.account.deviceLimit', {
          count: deviceCount,
          limit: account?.deviceLimit ?? '—',
        })}
      </h2>
      {devices}
      <footer>
        <button
          type="button"
          className="sea-button"
          data-variant="danger"
          onClick={onSignOut}
        >
          {t('tono.account.signOut')}
        </button>
        <p>{t('tono.account.signOutConfirmMessage')}</p>
      </footer>
      {dialogs}
    </div>
  )
}
