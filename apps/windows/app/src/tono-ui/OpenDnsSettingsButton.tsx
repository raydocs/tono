import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

import { openWindowsDnsSettings } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { TONO_COLORS } from '@/tono-ui/theme'

export const OpenDnsSettingsButton = ({
  accent = false,
}: {
  accent?: boolean
}) => {
  const { t } = useTranslation()
  const onOpen = useLockFn(async () => {
    try {
      await openWindowsDnsSettings()
    } catch (error) {
      showNotice.error(error)
    }
  })
  return (
    <button
      type="button"
      className="tono-button"
      onClick={() => void onOpen()}
      style={{
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 9,
        border: 'none',
        cursor: 'pointer',
        color: '#fff',
        background: accent ? TONO_COLORS.accent : TONO_COLORS.protectedOffline,
      }}
    >
      {t('tono.dashboard.openDnsSettings')}
    </button>
  )
}
