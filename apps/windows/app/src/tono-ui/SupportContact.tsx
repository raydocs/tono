import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

import { useTonoStatus } from '@/hooks/use-tono'
import { showNotice } from '@/services/notice-service'
import { TONO_COLORS, tonoText } from '@/tono-ui/theme'
import { useThemeMode } from '@/services/states'
import { version } from '@root/package.json'

import { nodeCityTitleKey, nodeDisplayName } from '@/pages/tono/node-meta'

export const buildSupportMessage = ({
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
}: {
  email?: string
  extra?: string
}) => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const server = status?.selectedServer
    ? nodeCityTitleKey(status.selectedServer)
      ? t(nodeCityTitleKey(status.selectedServer)!)
      : nodeDisplayName(status.selectedServer)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
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
      <button
        type="button"
        className="tono-button"
        onClick={() => void copy()}
        style={{
          minHeight: 32,
          padding: '6px 12px',
          fontSize: 12,
          color: '#fff',
          background: TONO_COLORS.accent,
        }}
      >
        {t('tono.support.contact.copyMessage')}
      </button>
    </div>
  )
}
