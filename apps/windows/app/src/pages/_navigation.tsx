import type { ComponentType, ReactNode } from 'react'

import { TonoIcon, type TonoIconName } from '@/tono-ui/TonoIcon'

import { navigationItems } from './_navigation-meta'
import SettingPage from './settings'
import TonoAccountPage from './tono/account'
import TonoActivityPage from './tono/activity'
import TonoDashboardPage from './tono/dashboard'
import TonoLoginPage from './tono/login'
import TonoServersPage from './tono/servers'
import TonoSupportPage from './tono/support'
import TonoTrayPage from './tono/tray'

type NavigationGroup = 'main' | 'advanced'

type NavigationItem = {
  label: (typeof navigationItems)[keyof typeof navigationItems]['label']
  path: string
  icon: ReactNode
  group: NavigationGroup
  Component: ComponentType
}

const navIcon = (name: TonoIconName) => <TonoIcon name={name} size={16} />

export const navItems: NavigationItem[] = [
  {
    ...navigationItems.dashboard,
    icon: navIcon('dashboard'),
    group: 'main',
    Component: TonoDashboardPage,
  },
  {
    ...navigationItems.activity,
    icon: navIcon('activity'),
    group: 'main',
    Component: TonoActivityPage,
  },
  {
    ...navigationItems.servers,
    icon: navIcon('nodes'),
    group: 'main',
    Component: TonoServersPage,
  },
  {
    ...navigationItems.account,
    icon: navIcon('account'),
    group: 'main',
    Component: TonoAccountPage,
  },
  {
    ...navigationItems.support,
    icon: navIcon('support'),
    group: 'main',
    Component: TonoSupportPage,
  },
  {
    ...navigationItems.settings,
    icon: navIcon('settings'),
    group: 'main',
    Component: SettingPage,
  },
]

// Reachable by URL but not listed in the navigation: the sign-in screen,
// which the auth guard routes through.
export const hiddenRoutes = [
  { path: '/login', Component: TonoLoginPage },
  { path: '/tray', Component: TonoTrayPage },
]

export type { NavigationGroup, NavigationItem }
