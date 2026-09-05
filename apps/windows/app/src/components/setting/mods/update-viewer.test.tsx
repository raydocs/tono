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
  prepare: vi.fn(),
  restart: vi.fn(),
  error: vi.fn(),
  setState: vi.fn(),
}))
vi.mock('@/hooks/use-update', () => ({
  useUpdate: () => ({
    updateInfo: {
      version: '1.2.3',
      body: mocks.body,
      download: mocks.download,
      install: mocks.install,
      downloadAndInstall: mocks.downloadAndInstall,
    },
  }),
}))
vi.mock('@/services/cmds', () => ({
  prepareUpdate: mocks.prepare,
  restartForUpdate: mocks.restart,
}))
vi.mock('@/services/notice-service', () => ({
  showNotice: { error: mocks.error },
}))
vi.mock('@/services/states', () => ({
  useUpdateState: () => false,
  useSetUpdateState: () => mocks.setState,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('rehype-raw', () => ({ default: () => {} }))
vi.mock('@/components/base', () => ({
  BaseDialog: ({
    open,
    onOk,
    okBtn,
    children,
  }: {
    open: boolean
    onOk: () => void
    okBtn: string
    children: ReactNode
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={onOk}>{okBtn}</button>
        {children}
      </div>
    ) : null,
}))

import { UpdateViewer } from './update-viewer'

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.body = 'Release notes'
  mocks.download.mockResolvedValue(undefined)
  mocks.install.mockResolvedValue(undefined)
  mocks.prepare.mockResolvedValue(undefined)
  // A successful Windows install exits the process: later JS cannot prepare.
  mocks.downloadAndInstall.mockRejectedValue(
    new Error('process exited before preparation'),
  )
})

function clickUpdate() {
  const ref = createRef<{ open: () => void; close: () => void }>()
  render(<UpdateViewer ref={ref} />)
  act(() => ref.current!.open())
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.modals.update.actions.update',
    }),
  )
}

describe('Windows update handoff ordering', () => {
  it('allows a valid update with no optional release notes', async () => {
    mocks.body = undefined
    clickUpdate()
    await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce())
    expect(mocks.prepare).toHaveBeenCalledWith('1.2.3')
  })

  it('waits for verified download and durable preparation before installing', async () => {
    let finishDownload!: () => void
    let finishPreparation!: () => void
    mocks.download.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDownload = resolve
      }),
    )
    mocks.prepare.mockReturnValue(
      new Promise<void>((resolve) => {
        finishPreparation = resolve
      }),
    )
    clickUpdate()
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
    await act(async () => finishDownload())
    expect(mocks.prepare).toHaveBeenCalledWith('1.2.3')
    expect(mocks.install).not.toHaveBeenCalled()
    await act(async () => finishPreparation())
    expect(mocks.install).toHaveBeenCalledOnce()
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
    expect(mocks.restart).not.toHaveBeenCalled()
  })

  it.each(['download', 'prepare', 'install'] as const)(
    'surfaces %s failure without advancing',
    async (stage) => {
      const error = new Error(`${stage} failed`)
      mocks[stage].mockRejectedValue(error)
      clickUpdate()
      await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(error))
      if (stage === 'download') expect(mocks.prepare).not.toHaveBeenCalled()
      if (stage !== 'install') expect(mocks.install).not.toHaveBeenCalled()
      expect(mocks.restart).not.toHaveBeenCalled()
      expect(mocks.setState).toHaveBeenLastCalledWith(false)
    },
  )
})
