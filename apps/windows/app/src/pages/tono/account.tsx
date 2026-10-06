import { useTranslation } from 'react-i18next'

import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { PageHeader } from '@/tono-ui/PageHeader'
import { TonoAccountCard } from '@/tono-ui/TonoAccountCard'

const AccountPage = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()

  return (
    <div className="tono-page">
      <PageHeader
        title={t('tono.account.title')}
        subtitle={t('tono.account.subtitle')}
      />
      <div style={{ maxWidth: newAppearance ? undefined : 520 }}>
        <TonoAccountCard />
      </div>
    </div>
  )
}

export default AccountPage
