import './assets/styles/index.scss'

import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { ResizeObserver } from '@juggle/resize-observer'
import { emit } from '@tauri-apps/api/event'
import { ComposeContextProvider } from 'foxact/compose-context-provider'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { SWRConfig } from 'swr'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { BaseErrorBoundary } from './components/base/base-error-boundary'
import { router } from './pages/_routers'
import { WindowProvider } from './providers/window'
import { FALLBACK_LANGUAGE, initializeLanguage } from './services/i18n'
import {
  preloadAppData,
  resolveThemeMode,
  getPreloadConfig,
} from './services/preload'
import { swrConfig } from './services/query-client'
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from './services/states'
import { getTauriStyleNonce } from './utils/csp-style-nonce'
import { disableWebViewShortcuts } from './utils/disable-webview-shortcuts'

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver
}

const mainElementId = 'root'
const APP_BOOTSTRAP_BUDGET_MS = 2000
const APP_BOOTSTRAP_TIMEOUT_MESSAGE =
  'initial App IPC/language preload timed out'
// Gates the host's initial window show (build_new_window on the Rust side):
// showing before the first painted frame can stick a cold WebView2
// compositor on a blank frame at the first launch after install.
const FIRST_PAINT_EVENT = 'tono-first-paint'
const container = document.getElementById(mainElementId)

if (!container) {
  throw new Error(`No container '${mainElementId}' found to render application`)
}

// Tauri rewrites the marked static style in index.html with the nonce allowed by the packaged
// app's CSP. Emotion otherwise creates an unnonced stylesheet that WebView2 rejects, leaving all
// MUI components without their structural CSS (an SVG icon can then expand to the whole card).
// In ordinary Vite development there is no nonce and Emotion behaves normally.
const emotionCache = createCache({
  key: 'css',
  nonce: getTauriStyleNonce(),
})

disableWebViewShortcuts()

let appInitialized = false
let pendingAppData: ReturnType<typeof preloadAppData> | null = null
const initializeApp = (initialThemeMode: 'light' | 'dark') => {
  if (appInitialized) return
  appInitialized = true
  const contexts = [
    <ThemeModeProvider key="theme" initialState={initialThemeMode} />,
    <LoadingCacheProvider key="loading" />,
    <UpdateStateProvider key="update" />,
  ]

  const root = createRoot(container)
  root.render(
    <CacheProvider value={emotionCache}>
      <React.StrictMode>
        <ComposeContextProvider contexts={contexts}>
          <BaseErrorBoundary>
            <SWRConfig value={swrConfig}>
              <WindowProvider>
                <RouterProvider router={router} />
              </WindowProvider>
            </SWRConfig>
          </BaseErrorBoundary>
        </ComposeContextProvider>
      </React.StrictMode>
    </CacheProvider>,
  )

  // Double rAF lands after the initial React commit has actually painted.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      emit(FIRST_PAINT_EVENT).catch(() => {
        // Outside Tauri (plain browser dev): nobody to signal.
      })
    })
  })
}

const bootstrap = async () => {
  const appDataPromise = preloadAppData()
  pendingAppData = appDataPromise
  const deadline = new Promise<never>((_, reject) => {
    window.setTimeout(
      () => reject(new Error(APP_BOOTSTRAP_TIMEOUT_MESSAGE)),
      APP_BOOTSTRAP_BUDGET_MS,
    )
  })

  const { initialThemeMode } = await Promise.race([appDataPromise, deadline])
  initializeApp(initialThemeMode)
}

bootstrap().catch((error) => {
  console.error(
    '[main.tsx] App bootstrap failed, falling back to default language:',
    error,
  )
  // Render immediately after the deadline. Language modules and the original IPC preload keep
  // resolving in the background; i18next will notify mounted consumers when resources arrive.
  initializeApp(resolveThemeMode(getPreloadConfig()))
  const fallbackLanguage = initializeLanguage(FALLBACK_LANGUAGE).catch(
    (fallbackError) => {
      console.error(
        '[main.tsx] Fallback language initialization failed:',
        fallbackError,
      )
    },
  )
  // When only the deadline fired, preserve the user's eventual language. Re-apply it after the
  // fallback load so completion order cannot leave a slow English/etc. preload overwritten by zh.
  if (
    error instanceof Error &&
    error.message === APP_BOOTSTRAP_TIMEOUT_MESSAGE &&
    pendingAppData
  ) {
    void pendingAppData
      .then(async ({ initialLanguage }) => {
        await fallbackLanguage
        await initializeLanguage(initialLanguage)
      })
      .catch((lateError) => {
        console.error('[main.tsx] Late App preload failed:', lateError)
      })
  }
})

// Error handling
window.addEventListener('error', (event) => {
  console.error('[main.tsx] Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[main.tsx] Unhandled promise rejection:', event.reason)
})

// Page close/refresh events
window.addEventListener('beforeunload', () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll()
})

// Page loaded event
window.addEventListener('DOMContentLoaded', () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll()
})
