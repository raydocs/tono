// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enTono from '@/locales/en/tono.json'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  verify: vi.fn(),
  mutate: vi.fn(),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({ status: {}, mutateTonoStatus: mocks.mutate }),
}))
vi.mock('@/services/tono', () => ({
  tonoSignInStart: mocks.start,
  tonoSignInVerify: mocks.verify,
  tonoDisconnect: vi.fn(),
  tonoRetryRestore: vi.fn(),
  formatTonoActionError: (error: Error) => error.message,
}))
vi.mock('@/tono-ui/SupportContact', () => ({ SupportContact: () => null }))

import LoginPage from './login'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono } } },
  lng: 'en',
})

beforeEach(() => {
  vi.useFakeTimers()
  mocks.start.mockReset().mockResolvedValue({ expiresIn: 600 })
  mocks.verify.mockReset()
  mocks.mutate.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function enterCodeStep() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'person@example.com' },
  })
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
  )
  for (let second = 0; second < 60; second++) {
    await act(async () => vi.advanceTimersByTime(1000))
  }
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Send again' })
}

describe('login request exclusion', () => {
  it('disables resend throughout verification and permits it after failure', async () => {
    const resend = await enterCodeStep()
    let rejectVerify!: (error: Error) => void
    mocks.verify.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectVerify = reject
        }),
    )
    await act(async () =>
      fireEvent.change(screen.getByLabelText('6-digit code'), {
        target: { value: '123456' },
      }),
    )
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Verifying…' })
        .disabled,
    ).toBe(true)
    fireEvent.click(resend)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(resend.disabled).toBe(true)

    await act(async () => rejectVerify(new Error('Code rejected')))
    expect(screen.getByRole('alert').textContent).toBe('Code rejected')
    expect(resend.disabled).toBe(false)
    await act(async () => fireEvent.click(resend))
    expect(mocks.start).toHaveBeenCalledTimes(2)
  })

  it('guards form submission while resend is pending, then releases the guard on failure', async () => {
    const resend = await enterCodeStep()
    mocks.verify.mockRejectedValue(new Error('Code rejected'))
    await act(async () =>
      fireEvent.change(screen.getByLabelText('6-digit code'), {
        target: { value: '123456' },
      }),
    )
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    let rejectSend!: (error: Error) => void
    mocks.start.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSend = reject
        }),
    )
    fireEvent.click(resend)
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Sign in',
    })
    expect(submit.disabled).toBe(true)
    await act(async () => fireEvent.submit(submit.closest('form')!))
    expect(mocks.verify).toHaveBeenCalledTimes(1)

    await act(async () => rejectSend(new Error('Send failed')))
    expect(submit.disabled).toBe(false)
    await act(async () => fireEvent.submit(submit.closest('form')!))
    expect(mocks.verify).toHaveBeenCalledTimes(2)
  })

  it('blocks resend before disabled renders and until account refresh completes', async () => {
    const resend = await enterCodeStep()
    mocks.verify.mockRejectedValueOnce(new Error('Code rejected'))
    await act(async () =>
      fireEvent.change(screen.getByLabelText('6-digit code'), {
        target: { value: '123456' },
      }),
    )
    mocks.verify.mockResolvedValue({ suspended: false })
    let finishRefresh!: () => void
    mocks.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    await act(async () => {
      fireEvent.submit(resend.closest('form')!)
      // Both events occur before React commits the disabled state.
      expect(resend.disabled).toBe(false)
      fireEvent.click(resend)
    })
    expect(mocks.verify).toHaveBeenCalledTimes(2)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    expect(resend.disabled).toBe(true)
    await act(async () => finishRefresh())
    expect(resend.disabled).toBe(false)
  })
})
