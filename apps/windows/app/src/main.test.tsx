// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const { liveFeeds, invoke, roots, languageLoad } = vi.hoisted(() => {
  // The plugin registry belongs to the native app, so it already contains
  // another WebView's feeds when a new tray WebView starts.
  const liveFeeds = new Set(['main:traffic', 'main:connections'])
  return {
    liveFeeds,
    roots: [] as Root[],
    languageLoad: { finish: undefined as (() => void) | undefined },
    invoke: vi.fn(async (command: string) => {
      if (command === 'plugin:tono-plugin-core|clear_all_ws_connections') {
        liveFeeds.clear()
      }
    }),
  }
})

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}) }))
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      roots.push(root)
      return root
    },
  }
})
vi.mock('./pages/_routers', async () => {
  const { createMemoryRouter } = await import('react-router')
  const { default: IntroPage } = await import('./pages/tono/intro')
  return { router: createMemoryRouter([{ path: '/', element: <IntroPage /> }]) }
})
vi.mock('./tono-ui/SeaScene', () => ({ SeaScene: () => null }))
vi.mock('./providers/window', () => ({
  WindowProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('./components/base/base-error-boundary', () => ({
  BaseErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('./services/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/i18n')>()
  return {
    ...actual,
    initializeLanguage: async (language: string) => {
      await new Promise<void>((resolve) => {
        languageLoad.finish = resolve
      })
      await actual.initializeLanguage(language)
    },
  }
})
vi.mock('./services/preload', () => ({
  preloadAppData: () => new Promise(() => {}),
  resolveThemeMode: () => 'light',
  getPreloadConfig: () => undefined,
}))
vi.mock('./utils/disable-webview-shortcuts', () => ({
  disableWebViewShortcuts: vi.fn(),
}))

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
  document.getElementById('root')?.remove()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

it('starting a tray WebView preserves the main window controller feeds', async () => {
  vi.useFakeTimers()
  Object.assign(window, { __TAURI_INTERNALS__: { invoke } })
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)

  // Execute the actual application entry and the actual plugin JS API in a
  // fresh WebView, whose local MihomoWebSocket instance set is empty.
  await import('./main')
  window.dispatchEvent(new Event('DOMContentLoaded'))
  await Promise.resolve()
  await Promise.resolve()

  expect(liveFeeds).toEqual(new Set(['main:traffic', 'main:connections']))
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === 'plugin:tono-plugin-core|clear_all_ws_connections',
    ),
  ).toBe(false)
})

it('keeps the first UI behind locale loading after the native deadline and respects cached English', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  localStorage.setItem('tono-language', 'en')
  await import('./main')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(container.textContent).toBe('')
  vi.useRealTimers()
  await act(async () => {
    languageLoad.finish?.()
  })
  expect(
    await screen.findByRole('heading', { name: 'Connected means protected.' }),
  ).toBeDefined()
  expect(screen.queryByText('连上，就受保护。')).toBeNull()
  expect(document.documentElement.lang).toBe('en')
})
