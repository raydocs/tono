import { getProxyByName } from 'tono-plugin-core-api'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.fn()
beforeEach(() => {
  invoke.mockReset()
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: {
      invoke,
      transformCallback: vi.fn(() => 1),
      unregisterCallback: vi.fn(),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('getProxyByName sends the key Tauri expects (proxyName, camelCase of proxy_name)', async () => {
  invoke.mockResolvedValue({ name: 'x' })
  await getProxyByName('test-proxy')
  expect(invoke).toHaveBeenCalledWith(
    'plugin:tono-plugin-core|get_proxy_by_name',
    { proxyName: 'test-proxy' },
    undefined,
  )
})
