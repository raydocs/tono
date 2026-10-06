import { useTranslation } from 'react-i18next'

import {
  isMotionPreference,
  setMotionPreference,
  setNewAppearance,
  useAppearancePreferences,
} from './appearance-preferences'
import { GlassCard } from './GlassCard'
import { SeaSegmented, SeaToggle } from './SeaControls'

/** Device-local presentation settings only; never writes native preferences. */
export const AppearanceCard = () => {
  const { t } = useTranslation()
  const { newAppearance, motion } = useAppearancePreferences()
  return (
    <GlassCard
      className={`sea-appearance-settings ${newAppearance ? '' : 'sea-appearance-legacy'}`}
    >
      <h2>{t('tono.settings.appearance.title')}</h2>
      <div className="tono-row">
        <div>
          <span>{t('tono.seaSettings.preview')}</span>
          <p>{t('tono.seaSettings.previewHint')}</p>
        </div>
        <SeaToggle
          checked={newAppearance}
          onChange={setNewAppearance}
          label={t('tono.seaSettings.preview')}
        />
      </div>
      <div className="tono-row sea-motion-row">
        <div>
          <span>{t('tono.seaSettings.motion')}</span>
          <p>{t('tono.seaSettings.motionHint')}</p>
        </div>
        <SeaSegmented
          label={t('tono.seaSettings.motion')}
          value={motion}
          options={(['auto', 'full', 'lite', 'static'] as const).map(
            (value) => ({
              value,
              label: t(`tono.scenePreview.qualityModes.${value}`),
            }),
          )}
          onChange={(value) => {
            if (isMotionPreference(value)) setMotionPreference(value)
          }}
        />
      </div>
    </GlassCard>
  )
}
