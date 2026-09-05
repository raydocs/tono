import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createHashRouter, RouterProvider } from 'react-router'
import en from '@/locales/en/tono.json'
import zh from '@/locales/zh/tono.json'
import LoginPage from '@/pages/tono/login'
import { MeshBackground } from '@/tono-ui/MeshBackground'
import { TonoSidebar } from '@/tono-ui/TonoSidebar'
import { ConnectPill } from '@/tono-ui/ConnectPill'
import { GlassCard } from '@/tono-ui/GlassCard'
import { useThemeMode } from './fixtures'
import '@/tono-ui/design-tokens.css'
import '@/tono-ui/tono.css'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { tono: en } },
    zh: { translation: { tono: zh } },
  },
  lng: new URLSearchParams(location.search).get('lang') || 'en',
  fallbackLng: 'en',
})

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
        </div>
      </main>
    </div>
  )
}

const router = createHashRouter([
  {
    path: '/login',
    element: (
      <main className="tono-main" style={{ height: '100%' }}>
        <LoginPage />
      </main>
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
