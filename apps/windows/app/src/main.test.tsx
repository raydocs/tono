// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const { liveFeeds, invoke } = vi.hoisted(() => {
  // The plugin registry belongs to the native app, so it already contains
  // another WebView's feeds when a new tray WebView starts.
  const liveFeeds = new Set(['main:traffic', 'main:connections'])
  return {
    liveFeeds,
    invoke: vi.fn(async (command: string) => {
      if (command === 'plugin:tono-plugin-core|clear_all_ws_connections') {
        liveFeeds.clear()
      }
    }),
  }
})

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}) }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn() }) }))
vi.mock('./pages/_routers', () => ({ router: {} }))
vi.mock('./providers/window', () => ({ WindowProvider: () => null }))
vi.mock('./components/base/base-error-boundary', () => ({
  BaseErrorBoundary: () => null,
}))
vi.mock('./services/i18n', () => ({
  FALLBACK_LANGUAGE: 'zh',
  initializeLanguage: vi.fn(async () => {}),
}))
vi.mock('./services/preload', () => ({
  preloadAppData: () => new Promise(() => {}),
  resolveThemeMode: () => 'light',
  getPreloadConfig: () => undefined,
}))
vi.mock('./utils/disable-webview-shortcuts', () => ({
  disableWebViewShortcuts: vi.fn(),
}))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
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
      ([command]) => command === 'plugin:tono-plugin-core|clear_all_ws_connections',
    ),
  ).toBe(false)
})
