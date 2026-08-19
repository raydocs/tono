import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import { navItems } from '@/pages/_navigation'
import { useThemeMode } from '@/services/states'
import { version as appVersion } from '@root/package.json'

import { TONO_COLORS, tonoText } from './theme'
import { TonoLogo } from './TonoLogo'

/**
 * The Tono sidebar (SidebarView.swift): 200 wide, brand on top, Dashboard /
 * Nodes / Account / Support in order, Settings pinned to the bottom.
 */

const SIDEBAR_MAIN_PATHS = ['/', '/servers', '/activity', '/account']
const SIDEBAR_FOOTER_PATHS = ['/support', '/settings']

export const TonoSidebar = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const location = useLocation()
  const navigate = useNavigate()

  const itemByPath = (path: string) =>
    navItems.find((item) => item.path === path)
  const mainItems = SIDEBAR_MAIN_PATHS.map(itemByPath).filter(
    (item): item is (typeof navItems)[number] => Boolean(item),
  )
  const footerItems = SIDEBAR_FOOTER_PATHS.map(itemByPath).filter(
    (item): item is (typeof navItems)[number] => Boolean(item),
  )

  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path)

  const navButton = (item: (typeof navItems)[number], key?: string) => {
    const active = isActive(item.path)
    return (
      <button
        key={key ?? item.path}
        type="button"
        className="tono-nav__item"
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate(item.path)}
        style={{
          // Structural properties are duplicated inline on purpose: a real
          // machine was found running with no layout stylesheet applied,
          // where these buttons fell back to native chrome and the whole
          // navigation read as blank boxes. Inline wins even then.
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          minHeight: 42,
          padding: '10px 12px',
          border: 'none',
          borderRadius: 12,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          background: active
            ? dark
              ? 'rgba(255,255,255,0.13)'
              : 'rgba(255,255,255,0.78)'
            : 'transparent',
          color: text.primary,
          fontWeight: active ? 600 : 400,
          boxShadow: active
            ? `inset 0 0 0 0.5px ${dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)'}, 0 8px 16px -10px rgba(0,0,0,${dark ? 0.45 : 0.18})`
            : 'none',
        }}
      >
        <span
          className="tono-nav__icon"
          style={{
            color: active ? TONO_COLORS.accent : text.primary,
          }}
        >
          {item.icon[0]}
        </span>
        <span>{t(item.label)}</span>
      </button>
    )
  }

  return (
    <nav
      className="tono-sidebar"
      style={{
        // See the note on the nav buttons: structural layout is inline so a
        // missing stylesheet cannot collapse the shell.
        width: 220,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 6px 12px',
        boxSizing: 'border-box',
        background: dark ? 'rgba(8,11,19,0.58)' : 'rgba(248,250,255,0.56)',
        borderRight: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(35,48,78,0.08)'}`,
      }}
    >
      <div className="tono-brand">
        <TonoLogo connected={false} compact size={22} />
        <span className="tono-brand-name" style={{ color: text.primary }}>
          Tono
        </span>
        <span className="tono-sidebar__version" style={{ color: text.tertiary }}>
          v{appVersion}
        </span>
      </div>

      <div className="tono-nav">{mainItems.map((item) => navButton(item))}</div>

      <div className="tono-nav__spacer" />

      <div
        className="tono-sidebar__divider"
        style={{
          background: dark ? 'rgba(255,255,255,0.14)' : 'rgba(20,22,30,0.12)',
        }}
      />
      <div className="tono-nav">
        {footerItems.map((item) => navButton(item))}
      </div>
    </nav>
  )
}
