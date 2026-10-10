import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

import { useTonoStatus } from '@/hooks/use-tono'
import { nodeCityLabel } from '@/pages/tono/node-meta'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { tonoText } from '@/tono-ui/theme'
import { version } from '@root/package.json'

const buildSupportMessage = ({
  version: appVersion,
  email,
  status,
  server,
  extra,
}: {
  version: string
  email?: string
  status?: string
  server?: string
  extra?: string
}) =>
  [
    `Tono ${appVersion}`,
    email ? `email ${email}` : null,
    status ? `status ${status}` : null,
    server ? `node ${server}` : null,
    extra || null,
  ]
    .filter(Boolean)
    .join('\n')

export const SupportContact = ({
  email,
  extra,
  compact = false,
}: {
  email?: string
  extra?: string
  compact?: boolean
}) => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const server = status?.selectedServer
    ? nodeCityLabel(status.selectedServer, t)
    : undefined

  const copy = useLockFn(async () => {
    const message = buildSupportMessage({
      version,
      email,
      status: status?.uiState,
      server,
      extra,
    })
    try {
      await navigator.clipboard.writeText(message)
      showNotice.success('tono.support.contact.copied')
    } catch (error) {
      showNotice.error(error)
    }
  })

  const button = (
    <button
      type="button"
      // The legacy action fill is violet; the sea uses its own quiet pill.
      className={newAppearance ? 'sea-button' : 'tono-button tono-action'}
      onClick={() => void copy()}
      style={{
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
      }}
    >
      {t('tono.support.contact.copyMessage')}
    </button>
  )
  if (compact) return button
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
      }}
    >
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
      {button}
    </div>
  )
}
