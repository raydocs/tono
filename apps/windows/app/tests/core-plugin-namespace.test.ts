import { MihomoWebSocket, getVersion } from 'tono-plugin-core-api'
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

it('the installed guest package invokes the desktop-authorized version command', async () => {
  invoke.mockResolvedValue({ version: 'test-core' })
  await expect(getVersion()).resolves.toEqual({ version: 'test-core' })
  expect(invoke).toHaveBeenCalledWith('plugin:tono-plugin-core|get_version', {}, undefined)
})

it.each([
  ['traffic', () => MihomoWebSocket.connect_traffic()],
  ['connections', () => MihomoWebSocket.connect_connections()],
] as const)('the packaged %s socket opens and closes in the same ACL namespace', async (suffix, connect) => {
  invoke.mockResolvedValue(42)
  const socket = await connect()
  expect(invoke).toHaveBeenNthCalledWith(1, `plugin:tono-plugin-core|ws_${suffix}`, {
    onMessage: expect.any(Object),
  }, undefined)
  await socket.close()
  expect(invoke).toHaveBeenNthCalledWith(2, 'plugin:tono-plugin-core|ws_disconnect', { id: 42, forceTimeout: 0 }, undefined)
})
