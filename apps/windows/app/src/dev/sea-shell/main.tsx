import i18n from 'i18next'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router'

import enSettings from '@/locales/en/settings.json'
import enShared from '@/locales/en/shared.json'
import en from '@/locales/en/tono.json'
import zhSettings from '@/locales/zh/settings.json'
import zhShared from '@/locales/zh/shared.json'
import zh from '@/locales/zh/tono.json'
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
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { tono: en, shared: enShared, settings: enSettings } },
    zh: { translation: { tono: zh, shared: zhShared, settings: zhSettings } },
  },
  lng: params.get('lang') === 'zh' ? 'zh' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})
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
createRoot(mount).render(<RouterProvider router={router} />)
