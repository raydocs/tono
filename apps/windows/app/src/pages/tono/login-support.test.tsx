// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setNewAppearance } from '@/tono-ui/appearance-preferences'

import enTono from '@/locales/en/tono.json'
import { version } from '@root/package.json'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: { accountState: 'signedOut', uiState: 'notConnected' },
    mutateTonoStatus: vi.fn(),
  }),
  tonoAccountQueryKey: ['tonoAccount'],
  tonoDevicesQueryKey: ['tonoDevices'],
  tonoServersQueryKey: ['tonoServers'],
}))
vi.mock('@/services/query-client', () => ({ removeCacheData: vi.fn() }))
vi.mock('@/services/notice-service', () => ({
  showNotice: { success: vi.fn(), error: vi.fn() },
}))

// Use real services/tono error handling and SupportContact, mocking only IPC
// and the clipboard boundary: assertions cover the actual copied payload.
import LoginPage from './login'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono } } },
  lng: 'en',
})

beforeEach(() => {
  // These cover the old look, which stays selectable; a fresh store now picks the new one.
  setNewAppearance(false)
  vi.useFakeTimers()
  mocks.invoke.mockReset().mockResolvedValue({ expiresIn: 600 })
  mocks.copy.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copy },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const supportHeader = `Tono ${version}\nemail person@example.com\nstatus notConnected`

function renderLogin() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'person@example.com' },
  })
}

async function copyForSupport() {
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy for support' })),
  )
  return mocks.copy.mock.lastCall?.[0] as string
}

async function waitForResend() {
  for (let second = 0; second < 60; second++) {
    await act(async () => vi.advanceTimersByTime(1000))
  }
}

describe('login support diagnostics', () => {
  it('copies send and verify classifications through the real UI and clears them on retry and reset', async () => {
    mocks.invoke.mockRejectedValueOnce(
      'TONO_AUTH_UNREACHABLE: could not reach Tono: pinned[connect: error sending request for url (https://example.invalid/auth?token=private-token)]; system-dns[timeout: request timed out]',
    )
    renderLogin()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('tono_sign_in_start', {
      email: 'person@example.com',
    })
    expect(screen.getByRole('alert').textContent).toBe(
      `${enTono.login.errors.unreachable} (TONO_AUTH_UNREACHABLE)`,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: send-code\nError code: TONO_AUTH_UNREACHABLE\nTransport: pinned=connect, system-dns=timeout`,
    )

    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    await waitForResend()
    expect(await copyForSupport()).toBe(`${supportHeader}\nNo email yet?`)

    mocks.invoke.mockRejectedValueOnce(
      'TONO_CLOCK_SKEW: could not reach Tono: TONO_CLOCK_SKEW: tls: certificate expired; code=654321; device=private-device',
    )
    await act(async () =>
      fireEvent.change(screen.getByLabelText('6-digit code'), {
        target: { value: '654321' },
      }),
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('tono_sign_in_verify', {
      email: 'person@example.com',
      code: '654321',
    })
    expect(screen.getByRole('alert').textContent).toBe(
      `${enTono.login.errors.clockSkew} (TONO_CLOCK_SKEW)`,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: verify-code\nError code: TONO_CLOCK_SKEW\nTransport: tls`,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use another email' }))
    expect(
      screen.queryByRole('button', { name: 'Copy for support' }),
    ).toBeNull()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    await waitForResend()
    expect(await copyForSupport()).toBe(`${supportHeader}\nNo email yet?`)
  })

  it('never copies arbitrary unmapped failure text or unrecognized stable tokens', async () => {
    mocks.invoke.mockRejectedValueOnce(
      'TONO_PRIVATE_ACCOUNT_ID: account=private-account device=private-device challenge=private-challenge email=private@example.invalid otp=654321 password=private-password token=private-token https://example.invalid/private-path?secret=private-query body=private-body server-response=private-response',
    )
    renderLogin()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(screen.getByRole('alert').textContent).toBe(
      enTono.errors.unknownAction,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: send-code\nError code: (none)`,
    )
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'other@example.com' },
    })
    expect(
      screen.queryByRole('button', { name: 'Copy for support' }),
    ).toBeNull()
  })
})
