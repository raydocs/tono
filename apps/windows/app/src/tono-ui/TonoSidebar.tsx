import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useNavigation } from 'react-router'

import { navItems } from '@/pages/_navigation'
import { useThemeMode } from '@/services/states'
import { version as appVersion } from '@root/package.json'

import { tonoAccent, tonoText } from './theme'
import { TonoLogo } from './TonoLogo'

/**
 * The Tono sidebar (SidebarView.swift): 200 wide, brand on top, Dashboard /
 * Nodes / Account / Support in order, Settings pinned to the bottom.
 */

const SIDEBAR_MAIN_PATHS = ['/', '/servers', '/activity', '/account']
const SIDEBAR_FOOTER_PATHS = ['/support', '/settings']

type NavItem = (typeof navItems)[number]

const TonoNavGroup = ({
  items,
  activePath,
  renderItem,
}: {
  items: NavItem[]
  activePath: string | undefined
  renderItem: (
    item: NavItem,
    ref: (el: HTMLButtonElement | null) => void,
  ) => ReactNode
}) => {
  const itemsRef = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState({
    y: 0,
    height: 42,
    visible: false,
  })

  const setItemRef = (path: string) => (el: HTMLButtonElement | null) => {
    if (el) itemsRef.current.set(path, el)
    else itemsRef.current.delete(path)
  }

  /* eslint-disable @eslint-react/set-state-in-effect -- indicator tracks offsetTop after layout */
  useLayoutEffect(() => {
    const hide = () =>
      setIndicator((prev) =>
        prev.visible ? { ...prev, visible: false } : prev,
      )
    const measure = () => {
      if (!activePath) {
        hide()
        return
      }
      const el = itemsRef.current.get(activePath)
      if (!el) {
        hide()
        return
      }
      const y = el.offsetTop
      const height = el.offsetHeight || 42
      setIndicator((prev) =>
        prev.y === y && prev.height === height && prev.visible
          ? prev
          : { y, height, visible: true },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activePath])
  /* eslint-enable @eslint-react/set-state-in-effect */

  return (
    <div className="tono-nav">
      <div className="tono-nav__track" style={{ position: 'relative' }}>
        <span
          className="tono-nav__indicator"
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: indicator.height,
            transform: `translateY(${indicator.y}px)`,
            opacity: indicator.visible ? 1 : 0,
            pointerEvents: 'none',
          }}
        />
        {items.map((item) => renderItem(item, setItemRef(item.path)))}
      </div>
    </div>
  )
}

export const TonoSidebar = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()

  const itemByPath = (path: string) =>
    navItems.find((item) => item.path === path)
  const mainItems = SIDEBAR_MAIN_PATHS.map(itemByPath).filter(
    (item): item is NavItem => Boolean(item),
  )
  const footerItems = SIDEBAR_FOOTER_PATHS.map(itemByPath).filter(
    (item): item is NavItem => Boolean(item),
  )

  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path)

  const navButton = (
    item: NavItem,
    ref: (el: HTMLButtonElement | null) => void,
  ) => {
    const active = isActive(item.path)
    return (
      <button
        key={item.path}
        ref={ref}
        type="button"
        className="tono-nav__item"
        aria-current={active ? 'page' : undefined}
        aria-busy={navigation.location?.pathname === item.path}
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
          borderRadius: 'var(--tono-radius-lg)',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          position: 'relative',
          zIndex: 1,
          background: 'transparent',
          color: text.primary,
          fontWeight: active ? 600 : 400,
        }}
      >
        <span
          className="tono-nav__icon"
          style={{
            color: active ? tonoAccent(dark) : text.primary,
          }}
        >
          {item.icon}
        </span>
        <span>{t(item.label)}</span>
        {navigation.location?.pathname === item.path && (
          <span aria-hidden="true">…</span>
        )}
      </button>
    )
  }

  return (
    <nav
      className="tono-sidebar"
      aria-label="Tono"
      style={{
        // See the note on the nav buttons: structural layout is inline so a
        // missing stylesheet cannot collapse the shell.
        width: 'clamp(184px, 21vw, 220px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 8px 16px',
        boxSizing: 'border-box',
        background: 'var(--tono-surface-sidebar)',
        borderRight: '1px solid var(--tono-surface-sidebar-border)',
      }}
    >
      <div className="tono-brand">
        <TonoLogo connected={false} compact size={22} />
        <span className="tono-brand-name" style={{ color: text.primary }}>
          Tono
        </span>
        <span
          className="tono-sidebar__version"
          style={{ color: text.tertiary }}
        >
          v{appVersion}
        </span>
      </div>

      <TonoNavGroup
        items={mainItems}
        activePath={mainItems.find((item) => isActive(item.path))?.path}
        renderItem={navButton}
      />

      <div className="tono-nav__spacer" />

      <div
        className="tono-sidebar__divider"
        style={{
          background: dark ? 'rgba(255,255,255,0.14)' : 'rgba(20,22,30,0.12)',
        }}
      />
      <TonoNavGroup
        items={footerItems}
        activePath={footerItems.find((item) => isActive(item.path))?.path}
        renderItem={navButton}
      />
    </nav>
  )
}
