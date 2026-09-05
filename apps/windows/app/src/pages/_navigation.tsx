import type { ComponentType, ReactNode } from 'react'

import { TonoIcon, type TonoIconName } from '@/tono-ui/TonoIcon'

import { navigationItems } from './_navigation-meta'
import TonoLoginPage from './tono/login'
import TonoTrayPage from './tono/tray'

type NavigationGroup = 'main' | 'advanced'

type NavigationItem = {
  label: (typeof navigationItems)[keyof typeof navigationItems]['label']
  path: string
  icon: ReactNode
  group: NavigationGroup
  lazy: () => Promise<{ Component: ComponentType }>
}

const navIcon = (name: TonoIconName) => <TonoIcon name={name} size={16} />

export const navItems: NavigationItem[] = [
  {
    ...navigationItems.dashboard,
    icon: navIcon('dashboard'),
    group: 'main',
    lazy: async () => ({
      Component: (await import('./tono/dashboard')).default,
    }),
  },
  {
    ...navigationItems.activity,
    icon: navIcon('activity'),
    group: 'main',
    lazy: async () => ({
      Component: (await import('./tono/activity')).default,
    }),
  },
  {
    ...navigationItems.servers,
    icon: navIcon('nodes'),
    group: 'main',
    lazy: async () => ({ Component: (await import('./tono/servers')).default }),
  },
  {
    ...navigationItems.account,
    icon: navIcon('account'),
    group: 'main',
    lazy: async () => ({ Component: (await import('./tono/account')).default }),
  },
  {
    ...navigationItems.support,
    icon: navIcon('support'),
    group: 'main',
    lazy: async () => ({ Component: (await import('./tono/support')).default }),
  },
  {
    ...navigationItems.settings,
    icon: navIcon('settings'),
    group: 'main',
    lazy: async () => ({ Component: (await import('./settings')).default }),
  },
]

// Reachable by URL but not listed in the navigation: the sign-in screen,
// which the auth guard routes through.
export const hiddenRoutes = [
  { path: '/login', Component: TonoLoginPage },
  { path: '/tray', Component: TonoTrayPage },
]

export type { NavigationGroup, NavigationItem }
