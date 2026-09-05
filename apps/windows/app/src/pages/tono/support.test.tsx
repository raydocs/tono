// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'
import type { TonoDiagnosticsReport } from '@/services/tono'

const {
  diagnosticsReportMock,
  uploadDiagnosticsMock,
  auditLogPathMock,
  checkTerminalEnvMock,
  clearTerminalProxyEnvMock,
  noticeSuccess,
  noticeError,
} = vi.hoisted(() => ({
  diagnosticsReportMock: vi.fn(),
  uploadDiagnosticsMock: vi.fn(),
  auditLogPathMock: vi.fn(),
  checkTerminalEnvMock: vi.fn(),
  clearTerminalProxyEnvMock: vi.fn(),
  noticeSuccess: vi.fn(),
  noticeError: vi.fn(),
}))

vi.mock('@/services/tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tono')>()),
  tonoDiagnosticsReport: diagnosticsReportMock,
  tonoUploadDiagnostics: uploadDiagnosticsMock,
  tonoAuditLogPath: auditLogPathMock,
  tonoCheckTerminalEnv: checkTerminalEnvMock,
  tonoClearTerminalProxyEnv: clearTerminalProxyEnvMock,
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: { uiState: 'connected', selectedServer: 'US West 1' },
  }),
}))

vi.mock('@/services/notice-service', () => ({
  showNotice: { success: noticeSuccess, error: noticeError, info: vi.fn() },
}))

import SupportPage from './support'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

const report: TonoDiagnosticsReport = {
  schemaVersion: 1,
  reportedAtMs: 1712345678901,
  appVersion: '0.0.18',
  osVersion: 'Windows 11 Pro 23H2',
  osArch: 'x86_64',
  serviceProtocol: '2.9',
  serviceBuild: '2.6.2',
  uiState: 'connected',
  accountState: 'ready',
  selectedServer: 'US West 1',
  catalogRevision: 12,
  killSwitchMode: 'locked',
  killSwitchWanted: true,
  killSwitchLive: true,
  killSwitchLastError: null,
  dnsEnabled: true,
  dnsLastError: null,
  failedStage: null,
  error: 'last redacted connection error',
  retryAttempt: 0,
  totalElapsedMs: 4200,
  steps: [{ key: 'verifyingTraffic', state: 'completed', elapsedMs: 4200 }],
  virtualAdapters: ['wsl'],
  auditLogPath: '%USERPROFILE%\\AppData\\Local\\Tono\\traffic-audit.jsonl',
  serviceLogPath: 'C:\\ProgramData\\Tono\\logs\\tono-service.log',
}

const freshSWR = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)

const renderPage = () => render(<SupportPage />, { wrapper: freshSWR })

const stubClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  return writeText
}

beforeEach(() => {
  diagnosticsReportMock.mockReset().mockResolvedValue(report)
  auditLogPathMock.mockReset().mockResolvedValue({
    path: 'C:\\Users\\Alice\\AppData\\Local\\Tono\\traffic-audit.jsonl',
    droppedCount: 0,
  })
  uploadDiagnosticsMock.mockReset().mockResolvedValue({
    referenceCode: 'TON-4F2K-9QX1',
    receivedAt: 1712345678,
  })
  noticeSuccess.mockReset()
  noticeError.mockReset()
  checkTerminalEnvMock.mockReset().mockResolvedValue({
    hasConflict: false,
    entries: [],
    claudeCodeReady: true,
    canAutoClear: false,
  })
  clearTerminalProxyEnvMock.mockReset().mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('Tono Support page', () => {
  it('shows only backend report summary fields and the local audit path', async () => {
    renderPage()

    expect(
      await screen.findByText('Tono 0.0.18 · Windows 11 Pro 23H2'),
    ).toBeDefined()
    expect(screen.getByText('2.9 · 2.6.2')).toBeDefined()
    expect(screen.getByText('Locked · Enabled')).toBeDefined()
    expect(screen.getByText('US West 1')).toBeDefined()
    expect(screen.getByText('last redacted connection error')).toBeDefined()
    expect(screen.getByTestId('tono-support-audit-path').textContent).toBe(
      'C:\\Users\\Alice\\AppData\\Local\\Tono\\traffic-audit.jsonl',
    )
    expect(diagnosticsReportMock).toHaveBeenCalled()
    expect(auditLogPathMock).toHaveBeenCalled()
  })

  it('marks an existing report refresh busy and prevents repeat activation', async () => {
    renderPage()
    await screen.findByText('Tono 0.0.18 · Windows 11 Pro 23H2')
    let finishRefresh!: (value: TonoDiagnosticsReport) => void
    const pendingReport = new Promise<TonoDiagnosticsReport>((resolve) => {
      finishRefresh = resolve
    })
    diagnosticsReportMock.mockReturnValue(pendingReport)
    const refresh = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Refresh',
    })
    fireEvent.click(refresh)
    expect.soft(refresh.disabled).toBe(true)
    expect.soft(refresh.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(refresh)
    expect.soft(diagnosticsReportMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Tono 0.0.18 · Windows 11 Pro 23H2')).toBeDefined()
    await act(async () => finishRefresh({ ...report, appVersion: '0.0.19' }))
    expect(screen.getByText('Tono 0.0.19 · Windows 11 Pro 23H2')).toBeDefined()
    expect(refresh.disabled).toBe(false)
    expect(refresh.getAttribute('aria-busy')).toBe('false')
  })

  it('keeps Refresh disabled during the initial diagnostics load', async () => {
    let finishLoad!: (value: TonoDiagnosticsReport) => void
    diagnosticsReportMock.mockReturnValue(
      new Promise<TonoDiagnosticsReport>((resolve) => {
        finishLoad = resolve
      }),
    )
    renderPage()
    const refresh = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Refresh',
    })
    expect(refresh.disabled).toBe(true)
    expect(refresh.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => finishLoad(report))
    expect(refresh.disabled).toBe(false)
    expect(screen.getByText('Tono 0.0.18 · Windows 11 Pro 23H2')).toBeDefined()
  })

  it('handles a rejected refresh through the existing alert and allows retry', async () => {
    renderPage()
    await screen.findByText('Tono 0.0.18 · Windows 11 Pro 23H2')
    diagnosticsReportMock.mockRejectedValueOnce(new Error('Report timed out'))
    const refresh = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Refresh',
    })
    await act(async () => fireEvent.click(refresh))
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't load the diagnostics summary. Refresh to try again.",
    )
    expect(refresh.disabled).toBe(false)
    await act(async () => fireEvent.click(refresh))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(diagnosticsReportMock).toHaveBeenCalledTimes(3)
  })

  it('copies the backend report and local audit path without constructing a payload', async () => {
    const writeText = stubClipboard()
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('Tono v0.0.18 diagnostics')
    expect(writeText.mock.calls[0][0]).toContain('Server: US West 1')

    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'C:\\Users\\Alice\\AppData\\Local\\Tono\\traffic-audit.jsonl',
      ),
    )
  })

  it('uploads only after confirmation, then displays and copies the receipt', async () => {
    const writeText = stubClipboard()
    renderPage()

    fireEvent.click(
      await screen.findByTestId('tono-support-upload-diagnostics'),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Upload diagnostics to Tono support',
    })
    expect(uploadDiagnosticsMock).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain(
      'never sends your configuration, keys, tokens, server addresses',
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send report' }))

    const receipt = await screen.findByTestId('tono-support-upload-reference')
    expect(uploadDiagnosticsMock).toHaveBeenCalledTimes(1)
    expect(receipt.textContent).toContain('TON-4F2K-9QX1')
    expect(screen.queryByTestId('tono-support-upload-diagnostics')).toBeNull()

    fireEvent.click(within(receipt).getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('TON-4F2K-9QX1'))
  })

  it('sends nothing when the upload confirmation is cancelled', async () => {
    renderPage()

    fireEvent.click(
      await screen.findByTestId('tono-support-upload-diagnostics'),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Upload diagnostics to Tono support',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(uploadDiagnosticsMock).not.toHaveBeenCalled()
  })
})

describe('support terminal environment diagnostic card', () => {
  it('renders ready badge when environment has no proxy conflict', async () => {
    renderPage()
    expect(
      await screen.findByText('Claude Code / Terminal Environment Diagnostics'),
    ).toBeDefined()
    expect(await screen.findByText('Environment Ready')).toBeDefined()
    expect(
      screen.queryByRole('button', {
        name: 'Clear Safe User Environment Variables',
      }),
    ).toBeNull()
  })

  it('renders conflict warning and clears proxy variables on button click', async () => {
    checkTerminalEnvMock.mockResolvedValueOnce({
      hasConflict: true,
      entries: [
        {
          key: 'HTTP_PROXY',
          value: 'http://127.0.0.1:7890',
          source: 'Process',
          guidance: 'Clear the inherited process variable.',
          autoClearable: true,
        },
      ],
      claudeCodeReady: false,
      canAutoClear: true,
    })
    renderPage()

    expect(await screen.findByText('Proxy Residue Detected')).toBeDefined()
    expect(screen.getByText('HTTP_PROXY=http://127.0.0.1:7890')).toBeDefined()

    const clearBtn = screen.getByRole('button', {
      name: 'Clear Safe User Environment Variables',
    })
    fireEvent.click(clearBtn)

    await waitFor(() =>
      expect(clearTerminalProxyEnvMock).toHaveBeenCalledTimes(1),
    )
    expect(noticeSuccess).toHaveBeenCalledWith(
      'Successfully cleared safe user proxy environment variables',
    )
  })

  it('shows source-specific manual guidance and restart requirements without unsafe cleanup', async () => {
    checkTerminalEnvMock.mockResolvedValueOnce({
      hasConflict: true,
      entries: [
        {
          key: 'https_proxy',
          value: 'http://127.0.0.1:7890',
          source:
            'VS Code workspace settings: C:\\work\\.vscode\\settings.json',
          guidance:
            'Remove the key from terminal.integrated.env.windows and restart VS Code.',
          autoClearable: false,
        },
      ],
      claudeCodeReady: false,
      canAutoClear: false,
    })
    renderPage()

    expect(await screen.findByText('Proxy Residue Detected')).toBeDefined()
    expect(
      screen.getByText(
        'Remove the key from terminal.integrated.env.windows and restart VS Code.',
      ),
    ).toBeDefined()
    expect(
      screen.getByText(
        'After fixing every source, fully restart Tono, VS Code, open terminals, WSL sessions, and any running Claude Code supervisor or parent process.',
      ),
    ).toBeDefined()
    expect(
      screen.queryByRole('button', {
        name: 'Clear Safe User Environment Variables',
      }),
    ).toBeNull()
    expect(screen.queryByText('Environment Ready')).toBeNull()
  })

  it('renders checking state while query is pending', () => {
    checkTerminalEnvMock.mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Checking…')).toBeDefined()
    expect(screen.queryByText('Environment Ready')).toBeNull()
  })

  it('renders check failed state when query rejects rather than falsely showing ready', async () => {
    checkTerminalEnvMock.mockRejectedValueOnce(
      new Error('Registry access denied'),
    )
    renderPage()
    expect(await screen.findByText('Check Failed')).toBeDefined()
    expect(screen.queryByText('Environment Ready')).toBeNull()
  })
})
