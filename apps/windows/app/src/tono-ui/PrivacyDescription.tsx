import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SeaPopover } from './SeaControls'

/** Full existing privacy copy remains available; no scope or defaults changed. */
export const PrivacyDescription = ({
  brief,
  full,
}: {
  brief: string
  full: string
}) => {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <span>{brief} </span>
      <button
        type="button"
        className="sea-privacy-help tono-link"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {t('tono.seaSettings.learnMore')}
      </button>
      <SeaPopover anchor={anchor} onClose={() => setAnchor(null)}>
        <p>{full}</p>
      </SeaPopover>
    </>
  )
}
