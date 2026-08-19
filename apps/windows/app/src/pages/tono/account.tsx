import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/tono-ui/PageHeader'
import { TonoAccountCard } from '@/tono-ui/TonoAccountCard'

const AccountPage = () => {
  const { t } = useTranslation()

  return (
    <div className="tono-page">
      <PageHeader
        title={t('tono.account.title')}
        subtitle={t('tono.account.subtitle')}
      />
      <div style={{ maxWidth: 520 }}>
        <TonoAccountCard />
      </div>
    </div>
  )
}

export default AccountPage
