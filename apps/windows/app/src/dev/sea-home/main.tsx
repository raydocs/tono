import i18n from 'i18next'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { Link, MemoryRouter, Route, Routes } from 'react-router'

import enShared from '@/locales/en/shared.json'
import en from '@/locales/en/tono.json'
import zhShared from '@/locales/zh/shared.json'
import zh from '@/locales/zh/tono.json'
import DashboardPage from '@/pages/tono/dashboard'
import {
  isMotionPreference,
  setMotionPreference,
  setNewAppearance,
} from '@/tono-ui/appearance-preferences'
import { TonoToastProvider } from '@/tono-ui/TonoToast'

import { HomePreviewDiagnostics } from './diagnostics'

import '@/tono-ui/design-tokens.css'
import '@/tono-ui/tono.css'

if (!import.meta.env.DEV) throw new Error('Home preview is development-only')
const parameters = new URLSearchParams(location.search)
setNewAppearance(parameters.get('appearance') !== 'old')
const quality = parameters.get('quality')
if (isMotionPreference(quality)) setMotionPreference(quality)
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { tono: en, shared: enShared } },
    zh: { translation: { tono: zh, shared: zhShared } },
  },
  lng: parameters.get('lang') === 'zh' ? 'zh' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

const mount = document.getElementById('root')
if (!mount) throw new Error('Missing home preview mount')
createRoot(mount).render(
  <div
    className="tono-root"
    data-tono-theme={parameters.get('theme') === 'light' ? 'light' : 'dark'}
  >
    <MemoryRouter>
      <TonoToastProvider>
        <div style={{ display: 'flex', height: '100%' }}>
          {!parameters.has('full') && (
            <aside
              style={{
                width: 200,
                flexShrink: 0,
                padding: 24,
                boxSizing: 'border-box',
                background: '#10131e',
                color: '#f6f2ec',
              }}
            >
              <strong>Tono</strong>
              <p>Home preview</p>
              <p style={{ fontSize: 12 }}>
                Simulated native IO. Existing 200px sidebar footprint; top bar
                belongs to PR 3.
              </p>
              <Link to="/" style={{ color: '#ffe2b0' }}>
                Home
              </Link>
            </aside>
          )}
          <main
            style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              height: '100%',
            }}
          >
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route
                path="/servers"
                element={
                  <div style={{ padding: 40 }}>
                    All lines (navigation destination only)
                    <p>
                      <Link to="/">Return home</Link>
                    </p>
                  </div>
                }
              />
            </Routes>
            {parameters.has('diagnostics') && <HomePreviewDiagnostics />}
          </main>
        </div>
      </TonoToastProvider>
    </MemoryRouter>
  </div>,
)
