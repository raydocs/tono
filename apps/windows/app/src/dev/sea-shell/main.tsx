import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { SWRConfig } from 'swr'

import { writeTonoIntroSeen } from '@/pages/_layout/tono-guard'
import SettingsPage from '@/pages/settings'
import AccountPage from '@/pages/tono/account'
import ActivityPage from '@/pages/tono/activity'
import DashboardPage from '@/pages/tono/dashboard'
import IntroPage from '@/pages/tono/intro'
import LoginPage from '@/pages/tono/login'
import ServersPage from '@/pages/tono/servers'
import SupportPage from '@/pages/tono/support'
import TrayPage from '@/pages/tono/tray'
import { preloadAppData } from '@/services/preload'
import { swrConfig } from '@/services/query-client'
import {
  setNewAppearance,
  setMotionPreference,
} from '@/tono-ui/appearance-preferences'
import TonoLayout from '@/tono-ui/tono-layout'

if (!import.meta.env.DEV) throw new Error('Shell preview is development-only')
const params = new URLSearchParams(location.search)
setNewAppearance(params.get('appearance') !== 'old')
setMotionPreference('static')
if (params.get('route') === '/intro') localStorage.removeItem('tono.introSeen')
else writeTonoIntroSeen()
// An explicit fixture locale simulates a saved native choice without a stale web cache.
// With no override, use the same no-choice startup as the packaged application.
if (params.has('lang')) {
  localStorage.removeItem('tono-language')
  localStorage.removeItem('verge-language')
}
await preloadAppData()
const router = createMemoryRouter(
  [
    {
      path: '/',
      element: <TonoLayout />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'tray', element: <TrayPage /> },
        { path: 'login', element: <LoginPage /> },
        { path: 'intro', element: <IntroPage /> },
        { path: 'servers', element: <ServersPage /> },
        { path: 'activity', element: <ActivityPage /> },
        { path: 'account', element: <AccountPage /> },
        { path: 'support', element: <SupportPage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ],
  { initialEntries: [params.get('route') ?? '/servers'] },
)
const mount = document.getElementById('root')
if (!mount) throw new Error('Missing shell mount')
createRoot(mount).render(
  <SWRConfig value={swrConfig}>
    <RouterProvider router={router} />
  </SWRConfig>,
)
