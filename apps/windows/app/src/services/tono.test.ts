import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

import {
  connectErrorSuggestsBackupChannel,
  connectErrorSuggestsServerSwitch,
  connectRejectionNeedsServerChoice,
  describeTonoActionError,
  formatTonoActionError,
  formatTonoDiagnostics,
  isEncryptedDnsFailure,
  stableTonoErrorCode,
  subscribeTonoStatus,
  tonoAuditEnabled,
  tonoAuditLogPath,
  tonoCancelServerTests,
  tonoCatalogStatus,
  tonoCloseAllConnections,
  tonoCloseConnection,
  tonoRefreshCatalog,
  tonoSetAuditEnabled,
  tonoTestAvailableServers,
  type TonoDiagnosticsReport,
  type TonoStatus,
} from './tono'

beforeEach(() => {
  invokeMock.mockReset()
  listenMock.mockReset()
})

describe('tono audit wrappers', () => {
  it('tonoAuditEnabled calls the audit flag command with no args', async () => {
    invokeMock.mockResolvedValue(true)

    await expect(tonoAuditEnabled()).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('tono_audit_enabled', undefined)
  })

  it('tonoSetAuditEnabled passes the flag through as args', async () => {
    invokeMock.mockResolvedValue(undefined)

    await tonoSetAuditEnabled(false)
    expect(invokeMock).toHaveBeenCalledWith('tono_set_audit_enabled', {
      enabled: false,
    })
  })

  it('tonoAuditLogPath returns the log info object', async () => {
    const info = { path: '/data/traffic-audit.jsonl', droppedCount: 3 }
    invokeMock.mockResolvedValue(info)

    await expect(tonoAuditLogPath()).resolves.toEqual(info)
    expect(invokeMock).toHaveBeenCalledWith('tono_audit_log_path', undefined)
  })

  it('normalizes backend string errors into Error instances', async () => {
    invokeMock.mockRejectedValue('kill switch still armed')

    await expect(tonoSetAuditEnabled(true)).rejects.toBeInstanceOf(Error)
    await expect(tonoSetAuditEnabled(true)).rejects.toThrow(
      'kill switch still armed',
    )
  })
})

describe('tono server management wrappers', () => {
  it('uses dedicated backend commands without frontend catalog data', async () => {
    invokeMock.mockResolvedValue({ revision: 8, nodeCount: 3 })

    await tonoCatalogStatus()
    await tonoRefreshCatalog()
    await tonoTestAvailableServers()
    await tonoCancelServerTests()

    expect(invokeMock.mock.calls).toEqual([
      ['tono_catalog_status', undefined],
      ['tono_refresh_catalog', undefined],
      ['tono_test_available_servers', undefined],
      ['tono_cancel_server_tests', undefined],
    ])
  })
})

describe('tono activity wrappers', () => {
  it('binds close mutations to the controller generation shown by the page', async () => {
    invokeMock.mockResolvedValue(undefined)

    await tonoCloseConnection('connection/id', 12)
    expect(invokeMock).toHaveBeenCalledWith('tono_close_connection', {
      id: 'connection/id',
      controllerGeneration: 12,
    })

    await tonoCloseAllConnections(12)
    expect(invokeMock).toHaveBeenCalledWith('tono_close_all_connections', {
      controllerGeneration: 12,
    })
  })
})

describe('subscribeTonoStatus', () => {
  const payload = { accountState: 'ready' } as TonoStatus

  it('shares one backend listener across subscribers and reference-counts the teardown', async () => {
    const unlisten = vi.fn()
    let emit: ((event: { payload: TonoStatus }) => void) | undefined
    listenMock.mockImplementation((_name: string, callback: unknown) => {
      emit = callback as (event: { payload: TonoStatus }) => void
      return Promise.resolve(unlisten)
    })

    const first = vi.fn()
    const second = vi.fn()
    const secondLive = vi.fn()
    const unsubFirst = subscribeTonoStatus(first)
    const unsubSecond = subscribeTonoStatus(second, secondLive)

    // Registration starts once, synchronously, no matter how many subscribers.
    expect(listenMock).toHaveBeenCalledTimes(1)
    expect(listenMock).toHaveBeenCalledWith('tono://status', expect.anything())
    // `secondLive` runs once the shared listener is live.
    await vi.waitFor(() => expect(secondLive).toHaveBeenCalledTimes(1))

    emit?.({ payload })
    expect(first).toHaveBeenCalledWith(payload)
    expect(second).toHaveBeenCalledWith(payload)

    // One subscriber leaving keeps the listener alive for the rest.
    unsubFirst()
    expect(unlisten).not.toHaveBeenCalled()
    emit?.({ payload })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    // The last teardown unlistens.
    unsubSecond()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})

describe('connectRejectionNeedsServerChoice', () => {
  it('matches every backend guard string that the server picker answers', () => {
    // Verbatim guard_snapshot rejections from app/src-tauri/src/tono/connection.rs.
    for (const message of [
      'select a server first',
      'the selected server is not in the catalog',
      'the exit catalog is not available yet',
      'the selected node left the catalog; pick a server again',
    ]) {
      expect(connectRejectionNeedsServerChoice(new Error(message))).toBe(true)
    }
  })

  it('leaves other rejections to the inline error path', () => {
    for (const message of [
      'TONO_SERVICE_BUSY: repair pending',
      'a connection transition is already in flight',
      'not signed in',
      '',
    ]) {
      expect(connectRejectionNeedsServerChoice(new Error(message))).toBe(false)
    }
    expect(connectRejectionNeedsServerChoice(undefined)).toBe(false)
  })
})

describe('connectErrorSuggestsServerSwitch', () => {
  it('recognizes blocked or unreachable exit failures', () => {
    for (const error of [
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
      'node or core unreachable after timeout',
      new Error('this server is currently unavailable (network blocked)'),
    ]) {
      expect(connectErrorSuggestsServerSwitch(error)).toBe(true)
    }
  })

  it('does not suggest switching for service or account failures', () => {
    for (const error of [
      new Error('TONO_SERVICE_BUSY: repair pending'),
      new Error('not signed in'),
      undefined,
    ]) {
      expect(connectErrorSuggestsServerSwitch(error)).toBe(false)
    }
  })

  it('maps the stable unreachable prefix to the actionable locale key', () => {
    expect(
      formatTonoActionError(
        new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.nodeUnreachable')
  })

  it('does not tell the user to switch cities when every probe dies at TLS', () => {
    const error = new Error(
      'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]',
    )
    expect(connectErrorSuggestsServerSwitch(error)).toBe(false)
    expect(formatTonoActionError(error, (key) => `translated:${key}`)).toBe(
      'translated:tono.dashboard.errors.protectedHttpsFailed',
    )
  })

  it('maps a bare CORE_EXIT_UNREACHABLE token without leaking handshake debug', () => {
    const error = new Error('CORE_EXIT_UNREACHABLE: dial timeout')
    expect(
      formatTonoActionError(error, (key) => `translated:${key}`),
    ).toBe('translated:tono.dashboard.errors.nodeUnreachable')
    expect(formatTonoActionError(error, (key) => `translated:${key}`)).not.toContain(
      'dial timeout',
    )
  })

  it('maps kernel pin and DNS-port failures to user-facing keys', () => {
    expect(
      formatTonoActionError(
        new Error(
          'no SHA-256 digest is pinned for the core binary, so "x" cannot be verified; reinstall Tono',
        ),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.coreUnpinned')
    expect(
      formatTonoActionError(
        new Error('DNS port 127.0.0.1:53 is unavailable (TCP: os error 10048)'),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.dnsPortBusy')
    expect(
      formatTonoActionError(
        new Error(
          'TONO_AUTH_DEVICE_LIMIT: this Tono account has reached its device allowance',
        ),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.login.errors.deviceLimit')
    expect(
      formatTonoActionError(
        new Error(
          'kill switch release failed; protection stays on: owner mismatch',
        ),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.protectionReleaseFailed')
    expect(
      formatTonoActionError(
        new Error(
          'fake-ip verification failed: Windows Encrypted DNS (DNS over HTTPS) may still be overriding 127.0.0.1. Turn Encrypted DNS off',
        ),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.encryptedDns')
    expect(
      isEncryptedDnsFailure(
        new Error(
          'fake-ip verification failed: Windows Encrypted DNS (DNS over HTTPS) may still be overriding 127.0.0.1',
        ),
      ),
    ).toBe(true)
    expect(isEncryptedDnsFailure(new Error('node unreachable'))).toBe(false)
  })

  it('maps strict browser DNS preflight without exposing backend detail', () => {
    expect(
      formatTonoActionError(
        new Error(
          'TONO_BROWSER_DNS_PREFLIGHT: Chrome: Secure DNS is set to Secure',
        ),
        (key) => `translated:${key}`,
      ),
    ).toBe('translated:tono.dashboard.errors.browserDnsPreflight')
  })
})

describe('connectErrorSuggestsBackupChannel', () => {
  it('offers the backup channel for handshake eof and unreachable exits', () => {
    for (const error of [
      new Error(
        'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]',
      ),
      new Error('CORE_EXIT_UNREACHABLE: dial timeout'),
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
      'this server is currently unavailable (network blocked)',
    ]) {
      expect(connectErrorSuggestsBackupChannel(error)).toBe(true)
    }
  })

  it('does not offer the backup channel for service, account, or DNS failures', () => {
    for (const error of [
      new Error('TONO_SERVICE_BUSY: repair pending'),
      new Error('not signed in'),
      new Error('dns probe failed: exit refused'),
      undefined,
    ]) {
      expect(connectErrorSuggestsBackupChannel(error)).toBe(false)
    }
  })
})

describe('describeTonoActionError', () => {
  const t = (key: string) => `translated:${key}`

  it('keeps mapped errors as a message with no diagnostic detail', () => {
    expect(
      describeTonoActionError(
        new Error('TONO_SERVICE_BUSY: repair pending'),
        t,
      ),
    ).toEqual({ message: 'translated:tono.dashboard.errors.serviceBusy' })
    expect(
      formatTonoActionError(new Error('TONO_SERVICE_BUSY: repair pending'), t),
    ).toBe('translated:tono.dashboard.errors.serviceBusy')
  })

  it('returns a localized fallback and the raw text as detail when nothing matches', () => {
    const raw =
      'sc.exe start TonoService failed: os error 10061; HKLM\\SYSTEM\\CurrentControlSet'
    expect(describeTonoActionError(new Error(raw), t)).toEqual({
      message: 'translated:tono.errors.unknownAction',
      detail: raw,
    })
    expect(formatTonoActionError(new Error(raw), t)).toBe(
      'translated:tono.errors.unknownAction',
    )
  })

  it('returns the raw string when no translator is provided', () => {
    const raw = 'os error 10061'
    expect(describeTonoActionError(raw)).toEqual({ message: raw })
    expect(formatTonoActionError(raw)).toBe(raw)
  })
})

describe('stable diagnostic copy', () => {
  const report = (
    overrides: Partial<TonoDiagnosticsReport> = {},
  ): TonoDiagnosticsReport => ({
    schemaVersion: 1,
    reportedAtMs: 0,
    appVersion: '0.0.72',
    osVersion: 'Windows 11',
    osArch: 'x86_64',
    serviceProtocol: '2.9',
    serviceBuild: null,
    uiState: 'notConnected',
    accountState: 'ready',
    selectedServer: 'Tokyo 1',
    catalogRevision: 1,
    killSwitchMode: 'blocked',
    killSwitchWanted: true,
    killSwitchLive: true,
    killSwitchLastError: null,
    dnsEnabled: true,
    dnsLastError: null,
    failedStage: 'checkingExit',
    error:
      'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]',
    retryAttempt: 1,
    totalElapsedMs: 1200,
    steps: [],
    virtualAdapters: [],
    auditLogPath: 'audit.jsonl',
    serviceLogPath: 'service.log',
    ...overrides,
  })

  it('extracts the stable code for Copy details without using it as the UI sentence', () => {
    const error =
      'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]'
    expect(stableTonoErrorCode(error)).toBe('TONO_NODE_OR_CORE_UNREACHABLE')
    expect(
      formatTonoActionError(new Error(error), (key) => `translated:${key}`),
    ).toBe('translated:tono.dashboard.errors.protectedHttpsFailed')

    const copied = formatTonoDiagnostics(report())
    expect(copied).toContain('Failed stage: checkingExit')
    expect(copied).toContain('Error code: TONO_NODE_OR_CORE_UNREACHABLE')
    expect(copied).toContain(`Error: ${error}`)
  })

  it('prints (none) when the report has no stable code', () => {
    expect(stableTonoErrorCode('dns probe failed')).toBeNull()
    expect(
      formatTonoDiagnostics(report({ error: 'dns probe failed' })),
    ).toContain('Error code: (none)')
  })
})
