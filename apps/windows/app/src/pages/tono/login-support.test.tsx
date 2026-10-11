// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enTono from '@/locales/en/tono.json'
import { setNewAppearance } from '@/tono-ui/appearance-preferences'
import { version } from '@root/package.json'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  copy: vi.fn(),
  status: {} as Record<string, unknown>,
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: mocks.status,
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
  mocks.status = { accountState: 'signedOut', uiState: 'notConnected' }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copy },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const supportHeader = `Tono ${version}\nstatus notConnected`

function renderLogin() {
  const view = render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'person@example.com' },
  })
  return view
}

async function copyForSupport() {
  const details = screen.getByText('Details').closest('details')
  if (!details?.open) fireEvent.click(screen.getByText('Details'))
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' })),
  )
  return mocks.copy.mock.lastCall?.[0] as string
}

async function waitForResend() {
  for (let second = 0; second < 60; second++) {
    await act(async () => vi.advanceTimersByTime(1000))
  }
}

describe('login support diagnostics', () => {
  it('distinguishes relay-only failures and exposes only safe per-relay classifications', async () => {
    mocks.invoke.mockRejectedValueOnce(
      'TONO_AUTH_TCP: could not reach Tono: TONO_RELAYS_UNREACHABLE: relay 2 (192.0.2.2:2053) timeout: private-token; relay 3 (192.0.2.3:2053) tls: https://example.invalid/auth?secret=private-query; relay 1 (192.0.2.1:2053) connect: private-device',
    )
    renderLogin()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(screen.getByRole('alert').textContent).toBe(
      "Tono's backup routes cannot be reached right now. Check your network or try again later. You do not need to turn protection off to retry.",
    )
    const details = screen.getByText('Details').closest('details')
    expect(details?.open).toBe(false)
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(details?.textContent).not.toMatch(
      /private-|192\.0\.2|pinned|system-dns/,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: send-code\nError code: TONO_AUTH_TCP\nRoutes: Tono relays\nRelay 2: timeout\nRelay 3: tls\nRelay 1: connect`,
    )
    expect(screen.getByText('Copied').getAttribute('role')).toBe('status')
    expect(details?.textContent).not.toContain('Relay 2: timeout')
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(screen.queryByText('Details')).toBeNull()
    await waitForResend()
    mocks.invoke.mockRejectedValueOnce(
      'TONO_AUTH_TCP: could not reach Tono: connect: private-token',
    )
    await act(async () =>
      fireEvent.change(screen.getByLabelText('6-digit code'), {
        target: { value: '654321' },
      }),
    )
    expect(screen.getByRole('alert').textContent).toBe(
      enTono.login.errors.unreachable,
    )
    expect(screen.getByText('Details').closest('details')?.open).toBe(false)
  })

  it('copies send and verify classifications through the real UI and clears them on retry and reset', async () => {
    mocks.invoke.mockRejectedValueOnce(
      'TONO_AUTH_UNREACHABLE: could not reach Tono: pinned[connect: error sending request for url (https://example.invalid/auth?token=private-token)]; system-dns[timeout: request timed out]; relay[179.253.233.220:2053: connect: error sending request for url (https://example.invalid:2053/auth?token=private-token)]',
    )
    renderLogin()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('tono_sign_in_start', {
      email: 'person@example.com',
    })
    expect(screen.getByRole('alert').textContent).toBe(
      enTono.login.errors.unreachable,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: send-code\nError code: TONO_AUTH_UNREACHABLE\nTransport: pinned=connect, system-dns=timeout, relay=connect`,
    )

    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    await waitForResend()
    expect(screen.getByText('No email yet?')).toBeDefined()
    expect(
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
    ).toBeNull()

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
      enTono.login.errors.clockSkew,
    )
    expect(await copyForSupport()).toBe(
      `${supportHeader}\nAuth stage: verify-code\nError code: TONO_CLOCK_SKEW\nTransport: tls`,
    )

    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Use another email' }),
      ),
    )
    expect(
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
    ).toBeNull()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    await waitForResend()
    expect(
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
    ).toBeNull()
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
      screen.queryByRole('button', { name: 'Copy diagnostics' }),
    ).toBeNull()
  })

  it('reports a refused clipboard write without success and offers only safe manual text', async () => {
    mocks.invoke.mockRejectedValueOnce(
      'TONO_AUTH_TCP: could not reach Tono: connect: token=secret email=private@example.invalid ip=192.0.2.1',
    )
    mocks.copy.mockRejectedValueOnce(new Error('clipboard denied'))
    renderLogin()
    expect(mocks.copy).not.toHaveBeenCalled()
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send code' })),
    )
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(screen.queryByText('Contact support.')).toBeNull()
    await copyForSupport()
    expect(screen.queryByText('Copied')).toBeNull()
    expect(screen.getByText(enTono.support.contact.copyFailed)).toBeDefined()
    fireEvent.click(screen.getByText('Copy manually'))
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Copy manually',
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(
      `${supportHeader}\nAuth stage: send-code\nError code: TONO_AUTH_TCP\nTransport: connect`,
    )
    await copyForSupport()
    expect(screen.getByText('Copied')).toBeDefined()
    expect(screen.queryByText(enTono.support.contact.copyFailed)).toBeNull()
  })

  it('offers final support only for the native userAction outcome and never copies its operation', async () => {
    mocks.status.signInRecovery = {
      operation: 987654321,
      step: 'sendCode',
      phase: 'automatic',
    }
    const view = renderLogin()
    expect(
      (screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      screen.queryByRole('button', {
        name: 'Contact support (copy diagnostics)',
      }),
    ).toBeNull()
    expect(mocks.copy).not.toHaveBeenCalled()
    mocks.status.signInRecovery = {
      operation: 987654321,
      step: 'sendCode',
      phase: 'userAction',
      cause: 'relaysUnreachable',
    }
    view.rerender(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Contact support (copy diagnostics)',
        }),
      ),
    )
    expect(mocks.copy.mock.lastCall?.[0]).toBe(
      `${supportHeader}\nRecovery cause: relaysUnreachable`,
    )
    expect(document.body.textContent).not.toContain('987654321')
    mocks.status.signInRecovery = undefined
    view.rerender(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(
      screen.queryByRole('button', {
        name: 'Contact support (copy diagnostics)',
      }),
    ).toBeNull()
  })
})
