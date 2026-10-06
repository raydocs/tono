import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

import type { TonoStatus } from '@/services/tono'

import { seaPresentation } from './sea-presentation'
import { TonoIcon } from './TonoIcon'
import { TonoLogo } from './TonoLogo'

const links = [
  ['/', 'tono.nav.dashboard'],
  ['/servers', 'tono.nav.nodes'],
  ['/activity', 'tono.nav.activity'],
  ['/account', 'tono.nav.account'],
] as const

export const SeaChrome = ({
  appearance,
  login,
  home,
  status,
  sidebar,
  controls,
  onDoubleClick,
}: {
  appearance: boolean
  login: boolean
  home: boolean
  status?: TonoStatus
  sidebar: ReactNode
  controls: ReactNode
  onDoubleClick: () => void
}) => {
  const { t } = useTranslation()
  if (!appearance) return login ? null : sidebar
  const { tone, titleKey } = seaPresentation(status)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: This is the native titlebar double-click affordance; window buttons remain keyboard-accessible.
    <header
      className="tono-sea-bar"
      data-tone={tone}
      data-tauri-drag-region="true"
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) onDoubleClick()
      }}
    >
      <div className="tono-sea-lockup" data-tauri-drag-region="true">
        <TonoLogo connected={false} size={26} />
        <span data-tauri-drag-region="true">Tono</span>
      </div>
      {!login && (
        <div className="tono-sea-navigation">
          <nav
            aria-label={t('tono.nav.dashboard')}
            className="tono-sea-capsule"
          >
            {links.map(([path, label]) => (
              <NavLink key={path} to={path} end={path === '/'} viewTransition>
                {t(label)}
              </NavLink>
            ))}
          </nav>
          {!home && (
            <NavLink
              to="/"
              className="tono-sea-state"
              title={status?.selectedServer ?? undefined}
            >
              <span className="tono-sea-state-dot" aria-hidden="true" />
              <span className="tono-sea-state-word">{t(titleKey)}</span>
            </NavLink>
          )}
          <NavLink
            to="/support"
            className="tono-sea-icon"
            aria-label={t('tono.nav.support')}
            title={t('tono.nav.support')}
          >
            ?
          </NavLink>
          <NavLink
            to="/settings"
            className="tono-sea-icon"
            aria-label={t('tono.nav.settings')}
            title={t('tono.nav.settings')}
          >
            <TonoIcon name="settings" size={16} />
          </NavLink>
        </div>
      )}
      <div className="tono-sea-window-controls">{controls}</div>
    </header>
  )
}
