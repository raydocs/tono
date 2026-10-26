// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  body: 'Release notes' as string | undefined,
  download: vi.fn(),
  install: vi.fn(),
  downloadAndInstall: vi.fn(),
  nativeInstall: vi.fn(),
  cancel: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/hooks/use-update', () => ({
  useUpdate: () => ({
    updateInfo: {
      version: '1.2.3',
      manifestSha256: 'a'.repeat(64),
      body: mocks.body,
      download: mocks.download,
      install: mocks.install,
      downloadAndInstall: mocks.downloadAndInstall,
    },
  }),
}))
vi.mock('@/services/update', () => ({
  installUpdate: mocks.nativeInstall,
  cancelUpdateDownload: mocks.cancel,
  UPDATE_DOWNLOAD_CANCELLED: 'TONO_UPDATE_CANCELLED',
}))
vi.mock('@/services/notice-service', () => ({
  showNotice: { error: mocks.error },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('rehype-raw', () => ({ default: () => {} }))
import { UpdateStateProvider } from '@/services/states'

import { UpdateViewer } from './update-viewer'

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.body = 'Release notes'
})

function clickUpdate() {
  const ref = createRef<{ open: () => void; close: () => void }>()
  render(
    <UpdateStateProvider>
      <UpdateViewer ref={ref} />
    </UpdateStateProvider>,
  )
  act(() => ref.current!.open())
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.modals.update.actions.update',
    }),
  )
  return ref
}

describe('Windows Service-owned update caller', () => {
  it('binds one native request, shows progress and an in-dialog refusal without retry or fallback', async () => {
    mocks.body = undefined
    let refuse!: (error: Error) => void
    mocks.nativeInstall.mockReturnValue(
      new Promise<void>((_, reject) => {
        refuse = reject
      }),
    )
    const ref = clickUpdate()
    expect(mocks.nativeInstall).toHaveBeenCalledWith(
      'a'.repeat(64),
      expect.any(Function),
    )
    const progress = mocks.nativeInstall.mock.calls[0][1]
    act(() => {
      progress({ event: 'Started', data: { contentLength: 1000 } })
      progress({ event: 'Progress', data: { chunkLength: 250 } })
    })
    expect(
      screen.getByRole('progressbar', { value: { now: 25, max: 100 } }),
    ).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    )
    expect(mocks.nativeInstall).toHaveBeenCalledOnce()
    const error = new Error('Service refused: protection retained')
    await act(async () => refuse(error))
    await waitFor(() =>
      expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
        'tono.update.refused',
      ),
    )
    expect(screen.getByRole('alert').textContent).not.toBe(error.message)
    expect(screen.getByText(error.message)).toBeDefined()
    expect(screen.getByRole('dialog').contains(screen.getByRole('alert'))).toBe(
      true,
    )
    expect(mocks.error).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('progressbar', { value: { max: 100 } }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.modals.update.actions.later',
      }),
    )
    act(() => ref.current!.open())
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
      'tono.update.refused',
    )
    expect(
      screen.queryByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    ).toBeNull()
    expect(mocks.nativeInstall).toHaveBeenCalledOnce()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('keeps Update available after a network failure and shows a human sentence', async () => {
    let refuse!: (error: Error) => void
    mocks.nativeInstall.mockReturnValue(
      new Promise<void>((_, reject) => {
        refuse = reject
      }),
    )
    clickUpdate()
    const error = new Error(
      'Protected update stopped: TONO_UPDATE_DOWNLOAD_FAILED: connection timed out',
    )
    await act(async () => refuse(error))
    await waitFor(() =>
      expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
        'tono.update.network',
      ),
    )
    expect(screen.getByText(error.message)).toBeDefined()
    expect(
      screen.getByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    ).toBeDefined()
  })

  it('hides Update now when the Service refused over network protection', async () => {
    let refuse!: (error: Error) => void
    mocks.nativeInstall.mockReturnValue(
      new Promise<void>((_, reject) => {
        refuse = reject
      }),
    )
    clickUpdate()
    const error = new Error(
      'Protected update stopped: network protection is uncertain',
    )
    await act(async () => refuse(error))
    await waitFor(() =>
      expect(screen.getByRole('alert').querySelector('p')?.textContent).not.toBe(
        'tono.update.network',
      ),
    )
    expect(
      screen.queryByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    ).toBeNull()
    expect(mocks.nativeInstall).toHaveBeenCalledOnce()
  })

  it('cancels a download in flight and leaves the same offer available again', async () => {
    let stop!: (error: Error) => void
    mocks.nativeInstall.mockReturnValue(
      new Promise<void>((_, reject) => {
        stop = reject
      }),
    )
    mocks.cancel.mockResolvedValue(true)
    const ref = clickUpdate()
    fireEvent.click(
      screen.getByRole('button', { name: 'shared.actions.cancel' }),
    )
    expect(mocks.cancel).toHaveBeenCalledOnce()
    await act(async () =>
      stop(
        new Error(
          'Protected update stopped: TONO_UPDATE_CANCELLED: update download cancelled',
        ),
      ),
    )
    act(() => ref.current!.open())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: 'settings.modals.update.actions.update',
      }),
    ).toBeDefined()
  })
})
