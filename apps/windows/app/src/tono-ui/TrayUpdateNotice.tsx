import { useTranslation } from 'react-i18next'

export const TrayUpdateNotice = ({
  version,
  onUpdateNow,
  onLater,
}: {
  version: string
  onUpdateNow: () => void
  onLater: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="sea-tray-update" role="status">
      <p>{t('tono.update.trayAvailable', { version })}</p>
      <div className="sea-tray-update-actions">
        <button type="button" onClick={onUpdateNow}>
          {t('tono.update.updateNow')}
        </button>
        <button type="button" onClick={onLater}>
          {t('tono.update.later')}
        </button>
      </div>
    </div>
  )
}
