import { useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createHashRouter, RouterProvider } from 'react-router'
import en from '@/locales/en/tono.json'
import zh from '@/locales/zh/tono.json'
import enShared from '@/locales/en/shared.json'
import zhShared from '@/locales/zh/shared.json'
import enSettings from '@/locales/en/settings.json'
import zhSettings from '@/locales/zh/settings.json'
import DashboardPage from '@/pages/tono/dashboard'
import { UpdateViewer } from '@/components/setting/mods/update-viewer'
import type { DialogRef } from '@/components/base'
import { NoticeManager } from '@/components/layout/notice-manager'
import { UpdateStateProvider } from '../../src/services/states'
import IntroPage from '@/pages/tono/intro'
import LoginPage from '@/pages/tono/login'
import SupportPage from '@/pages/tono/support'
import ServersPage from '@/pages/tono/servers'
import ActivityPage from '@/pages/tono/activity'
import { ConnectProgressCard } from '@/pages/tono/connect-progress'
import { MeshBackground } from '@/tono-ui/MeshBackground'
import { TonoSidebar } from '@/tono-ui/TonoSidebar'
import { ConnectPill } from '@/tono-ui/ConnectPill'
import { GlassCard } from '@/tono-ui/GlassCard'
import { WelcomeHeroTile } from '@/tono-ui/WelcomeHeroTile'
import { useThemeMode } from './fixtures'
import '@/tono-ui/design-tokens.css'
import '@/tono-ui/tono.css'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { tono: en, shared: enShared, settings: enSettings } },
    zh: { translation: { tono: zh, shared: zhShared, settings: zhSettings } },
  },
  lng: new URLSearchParams(location.search).get('lang') || 'en',
  fallbackLng: 'en',
  // Match production i18n: React escapes text, so i18next must not escape it twice.
  interpolation: { escapeValue: false },
})

function PreviewShell({ children }: { children: ReactNode }) {
  return (
    <div className="tono-shell">
      <TonoSidebar />
      <main className="tono-main" style={{ overflow: 'auto' }}>
        <p
          style={{
            margin: '16px 24px 0',
            fontSize: 11,
            color: 'var(--tono-text-secondary)',
          }}
        >
          0.0.73 UI preview · synthetic data · no native/network actions
        </p>
        {children}
      </main>
    </div>
  )
}

function Components() {
  const [connected, setConnected] = useState(false)
  return (
    <div className="tono-shell">
      <TonoSidebar />
      <main className="tono-main">
        <div
          className="tono-page"
          style={{ padding: 40, display: 'grid', gap: 24 }}
        >
          <h1 className="tono-page-title">Connection</h1>
          <p>Component preview · simulated network, not a live connection</p>
          <ConnectPill
            uiState={connected ? 'connected' : 'notConnected'}
            onConnect={() => setConnected(true)}
            onDisconnect={() => setConnected(false)}
          />
          <GlassCard>
            <h2>No node selected</h2>
            <p>Choose a node in Tono to get connected.</p>
          </GlassCard>
          <h1 className="tono-page-title">Welcome v2</h1>
          <p>
            <a href="#/intro">Intro</a>
            {' · '}
            <a href="#/login">Login story</a>
          </p>
          <div
            className="tono-welcome-ground"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 280,
              borderRadius: 20,
              overflow: 'hidden',
            }}
          >
            <div style={{ width: 180 }}>
              <WelcomeHeroTile />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function UpdatePreview() {
  const dialog = useRef<DialogRef>(null)
  return (
    <UpdateStateProvider>
      <PreviewShell>
        <div className="tono-page">
          <button onClick={() => dialog.current?.open()}>Review update</button>
          <UpdateViewer ref={dialog} />
          <NoticeManager />
        </div>
      </PreviewShell>
    </UpdateStateProvider>
  )
}

const router = createHashRouter([
  { path: '/update', element: <UpdatePreview /> },
  {
    path: '/dashboard',
    element: (
      <PreviewShell>
        <DashboardPage />
      </PreviewShell>
    ),
  },
  {
    path: '/login',
    element: (
      <main className="tono-main" style={{ height: '100%' }}>
        <LoginPage />
      </main>
    ),
  },
  {
    path: '/intro',
    element: (
      <main className="tono-main" style={{ height: '100%' }}>
        <IntroPage />
      </main>
    ),
  },
  {
    path: '/support',
    element: (
      <PreviewShell>
        <SupportPage />
      </PreviewShell>
    ),
  },
  {
    path: '/servers',
    element: (
      <PreviewShell>
        <ServersPage />
      </PreviewShell>
    ),
  },
  {
    path: '/activity',
    element: (
      <PreviewShell>
        <ActivityPage />
      </PreviewShell>
    ),
  },
  {
    path: '/recovery',
    element: (
      <PreviewShell>
        <div className="tono-page">
          <ConnectProgressCard
            uiState="protectedOffline"
            protectionConfirmed
            selectedServer="Tokyo · Sakura"
            onRefreshStatus={async () => {}}
          />
        </div>
      </PreviewShell>
    ),
  },
  { path: '*', element: <Components /> },
])

createRoot(document.getElementById('root')!).render(
  <div
    className="tono-root"
    data-tono-refined=""
    data-tono-theme={useThemeMode()}
  >
    <MeshBackground dark={useThemeMode() !== 'light'} />
    <RouterProvider router={router} />
  </div>,
)
