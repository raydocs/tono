// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prerequisites: vi.fn(),
  repair: vi.fn(),
}))

vi.mock('@/services/tono', () => ({
  tonoServicePrerequisites: mocks.prerequisites,
  tonoRepairService: mocks.repair,
  formatTonoActionError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { ServicePrereqBanner } from './ServicePrereqBanner'

describe('ServicePrereqBanner', () => {
  afterEach(cleanup)
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    mocks.prerequisites.mockReset()
    mocks.repair.mockReset().mockResolvedValue(undefined)
  })

  it('coalesces stalled polls across remounts and checks fresh state after repair', async () => {
    vi.useFakeTimers()
    const stopped = {
      serviceRunning: false,
      serviceRegistered: true,
      bfeRunning: false,
    }
    let release!: (value: typeof stopped) => void
    mocks.prerequisites
      .mockResolvedValueOnce(stopped)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue({ ...stopped, serviceRunning: true, bfeRunning: true })
    const first = render(<ServicePrereqBanner />)
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    first.unmount()
    render(<ServicePrereqBanner />)
    await act(async () => {
      vi.advanceTimersByTime(90_000)
    })
    expect(mocks.prerequisites).toHaveBeenCalledTimes(2)
    await act(async () => {
      release(stopped)
    })
    mocks.prerequisites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    // Repair control work must remain usable while the query is stalled.
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'tono.servicePrereq.repair' }),
      )
    })
    expect(mocks.repair).toHaveBeenCalledTimes(1)
    expect(mocks.prerequisites).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    await act(async () => {
      release(stopped)
    })
    expect(mocks.prerequisites).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing while the service is running', async () => {
    mocks.prerequisites.mockResolvedValue({
      serviceRunning: true,
      serviceRegistered: true,
      bfeRunning: true,
    })
    render(<ServicePrereqBanner />)
    await waitFor(() => expect(mocks.prerequisites).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names BFE when that is what is stopping the service', async () => {
    mocks.prerequisites.mockResolvedValue({
      serviceRunning: false,
      serviceRegistered: true,
      bfeRunning: false,
    })
    render(<ServicePrereqBanner />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    // The specific cause, not the generic "service did not start" — naming BFE is the whole
    // point, because it is the sentence that ends the support conversation.
    expect(screen.getByText('tono.servicePrereq.bfe')).toBeDefined()
    expect(screen.queryByText('tono.servicePrereq.generic')).toBeNull()
  })

  it('falls back to the generic cause when BFE is healthy', async () => {
    mocks.prerequisites.mockResolvedValue({
      serviceRunning: false,
      serviceRegistered: true,
      bfeRunning: true,
    })
    render(<ServicePrereqBanner />)
    await waitFor(() =>
      expect(screen.getByText('tono.servicePrereq.generic')).toBeDefined(),
    )
  })

  it('stays quiet when the service is not installed, which is a different flow', async () => {
    mocks.prerequisites.mockResolvedValue({
      serviceRunning: false,
      serviceRegistered: false,
      bfeRunning: true,
    })
    render(<ServicePrereqBanner />)
    await waitFor(() => expect(mocks.prerequisites).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-checks after a repair instead of assuming it worked', async () => {
    mocks.prerequisites
      .mockResolvedValueOnce({
        serviceRunning: false,
        serviceRegistered: true,
        bfeRunning: false,
      })
      .mockResolvedValue({
        serviceRunning: true,
        serviceRegistered: true,
        bfeRunning: true,
      })
    render(<ServicePrereqBanner />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())

    fireEvent.click(
      screen.getByRole('button', { name: 'tono.servicePrereq.repair' }),
    )
    await waitFor(() => expect(mocks.repair).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows why a repair failed rather than looking like a dead button', async () => {
    mocks.prerequisites.mockResolvedValue({
      serviceRunning: false,
      serviceRegistered: true,
      bfeRunning: false,
    })
    mocks.repair.mockRejectedValue(new Error('elevation declined'))
    render(<ServicePrereqBanner />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())

    fireEvent.click(
      screen.getByRole('button', { name: 'tono.servicePrereq.repair' }),
    )
    await waitFor(() =>
      expect(screen.getByText('elevation declined')).toBeDefined(),
    )
  })
})
