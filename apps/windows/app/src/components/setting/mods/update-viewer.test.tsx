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
}

describe('Windows Service-owned update caller', () => {
  it('binds one native request to the selected manifest, shows progress and never falls back on refusal', async () => {
    mocks.body = undefined
    let refuse!: (error: Error) => void
    mocks.nativeInstall.mockReturnValue(
      new Promise<void>((_, reject) => {
        refuse = reject
      }),
    )
    clickUpdate()
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
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(error))
    expect(
      screen.queryByRole('progressbar', { value: { max: 100 } }),
    ).toBeNull()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
  })
})
