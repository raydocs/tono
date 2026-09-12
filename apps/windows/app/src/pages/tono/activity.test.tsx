// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18n from 'i18next'
import { Fragment } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'

const {
  closeConnectionMock,
  closeAllConnectionsMock,
  connectionDataMock,
  tonoStatusMock,
  useConnectionDataMock,
} = vi.hoisted(() => ({
  closeConnectionMock: vi.fn(),
  closeAllConnectionsMock: vi.fn(),
  connectionDataMock: { activeConnections: [] as IConnectionsItem[] },
  tonoStatusMock: { uiState: 'connected', controllerGeneration: 7 },
  useConnectionDataMock: vi.fn(),
}))

vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({ status: tonoStatusMock }),
}))

vi.mock('@/hooks/use-connection-data', () => ({
  useConnectionData: useConnectionDataMock,
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
vi.mock('@/services/notice-service', () => ({
  showNotice: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('@/services/tono', () => ({
  tonoCloseConnection: closeConnectionMock,
  tonoCloseAllConnections: closeAllConnectionsMock,
}))
vi.mock('@/components/base/virtual-list', () => ({
  VirtualList: ({
    count,
    getItemKey,
    renderItem,
  }: {
    count: number
    getItemKey: (index: number) => React.Key
    renderItem: (index: number) => React.ReactNode
  }) => (
    <div role="list">
      {Array.from({ length: count }, (_, index) => (
        <Fragment key={getItemKey(index)}>{renderItem(index)}</Fragment>
      ))}
    </div>
  ),
}))

import ActivityPage from './activity'
import {
  activityProcessFamily,
  classifyActivityRoute,
  isWeChatActivityProcess,
  sanitizeActivityValue,
  toActivityRow,
  WECHAT_ACTIVITY_PROCESS,
  aggregateActivityApps,
} from './activity-model'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

const connection = (
  id: string,
  overrides: Partial<IConnectionsItem> = {},
): IConnectionsItem => ({
  id,
  metadata: {
    network: 'tcp',
    type: 'HTTPS',
    host: `${id}.example.com`,
    sourceIP: '198.18.0.1',
    sourcePort: '50000',
    destinationPort: '443',
    destinationIP: '203.0.113.1',
    remoteDestination: '',
    process: `${id}.exe`,
    processPath: `C:\\Users\\private-user\\${id}.exe`,
  },
  upload: 0,
  download: 0,
  start: '2026-08-06T00:00:00Z',
  chains: ['Tono Cloud'],
  rule: 'DOMAIN-SUFFIX',
  rulePayload: 'example.com',
  ...overrides,
})

const localDnsConnection = (
  id: string,
  overrides: Partial<IConnectionsItem> = {},
): IConnectionsItem =>
  connection(id, {
    metadata: {
      ...connection(id).metadata,
      host: '',
      destinationIP: '127.0.0.1',
      destinationPort: '53',
    },
    chains: ['DIRECT'],
    rule: 'IPCIDR',
    rulePayload: '127.0.0.0/8',
    ...overrides,
  })

beforeEach(() => {
  closeConnectionMock.mockReset().mockResolvedValue(undefined)
  closeAllConnectionsMock.mockReset().mockResolvedValue(undefined)
  tonoStatusMock.uiState = 'connected'
  useConnectionDataMock.mockReset().mockReturnValue({
    response: { data: connectionDataMock, live: true },
    refreshGetClashConnection: vi.fn(),
  })
  connectionDataMock.activeConnections = [
    connection('proxy'),
    connection('direct', { chains: ['DIRECT'] }),
    connection('blocked', { chains: ['REJECT-DROP'], rule: 'MATCH' }),
  ]
})

afterEach(cleanup)

describe('Activity connection presentation', () => {
  it('classifies managed-controller routes from chains and rejection rules', () => {
    expect(classifyActivityRoute(connection('proxy'))).toBe('proxied')
    expect(
      classifyActivityRoute(connection('direct', { chains: ['DIRECT'] })),
    ).toBe('direct')
    expect(
      classifyActivityRoute(connection('blocked', { chains: ['REJECT-DROP'] })),
    ).toBe('rejected')
    expect(
      classifyActivityRoute(connection('named', { chains: ['REJECT-us'] })),
    ).toBe('proxied')
    expect(
      classifyActivityRoute(connection('lower', { chains: ['direct'] })),
    ).toBe('proxied')
    // An empty chain is an unrecognized shape, not a proxied one: match macOS
    // routeClass, which guards `chains.isEmpty` alongside DIRECT before its
    // `.tunnel` fallthrough. Without this guard the empty case falls through to
    // the proxied default and mislabels the per-app split for one frame.
    expect(
      classifyActivityRoute(connection('empty', { chains: [], rule: '' })),
    ).toBe('direct')
  })

  it('only badges a flow as home when it really left through home broadband', () => {
    expect(
      classifyActivityRoute(
        connection('residential', { chains: ['Tono-Home-Residential'] }),
      ),
    ).toBe('home')
    expect(
      classifyActivityRoute(
        connection('claude-home', {
          chains: ['HomeNode', 'Tono-Claude-Home'],
        }),
      ),
    ).toBe('home')
    // Fell back to the datacenter exit: those bytes never used the home IP, so
    // claiming 家宽 would be a false statement about the customer's identity.
    expect(
      classifyActivityRoute(
        connection('fell-back', {
          chains: ['Tono-Exit', 'Tono-Claude-Home'],
        }),
      ),
    ).toBe('proxied')
  })

  it('badges an empty chain as direct on a public host and as local on loopback', () => {
    // Regression: an empty chain on a non-loopback destination used to fall
    // through to the proxied default. It is now badged direct, matching macOS
    // routeClass, and is reachable end-to-end through toActivityRow (not swept
    // into the loopback `local` short-circuit, since the host is public).
    expect(
      toActivityRow(connection('empty-public', { chains: [], rule: '' })).route,
    ).toBe('direct')
    // The loopback regex short-circuit in toActivityRow still wins over the
    // empty-chain case, so DNS to 127.0.0.1:53 is badged local regardless of a
    // missing chain — the dominant loopback traffic never reaches the bug path.
    expect(
      toActivityRow(
        connection('empty-loopback', {
          metadata: {
            ...connection('empty-loopback').metadata,
            host: '',
            destinationIP: '127.0.0.1',
            destinationPort: '53',
          },
          chains: [],
          rule: 'IPCIDR',
          rulePayload: '127.0.0.0/8',
        }),
      ).route,
    ).toBe('local')
  })

  it('classifies loopback targets as local, never as direct', () => {
    const dns = connection('dns', {
      metadata: {
        ...connection('dns').metadata,
        host: '',
        destinationIP: '127.0.0.1',
        destinationPort: '53',
      },
      chains: ['DIRECT'],
      rule: 'IPCIDR',
      rulePayload: '127.0.0.0/8',
    })
    expect(toActivityRow(dns).route).toBe('local')
    // A public host on the same DIRECT terminal still reports direct.
    expect(
      toActivityRow(
        connection('cdn', {
          chains: ['DIRECT'],
          rule: 'AND',
          rulePayload: '((Network,tcp) && (DomainSuffix,baidu.com))',
        }),
      ).route,
    ).toBe('direct')
    // The Tono China direct groups are direct routes too (WeChat/suffix rules).
    expect(
      toActivityRow(
        connection('wechat', {
          chains: ['Tono-China-Direct'],
          rule: 'AND',
          rulePayload: '((Network,tcp) && (ProcessName,Weixin.exe))',
        }),
      ).route,
    ).toBe('direct')
    expect(
      toActivityRow(
        connection('baidu', {
          chains: ['Tono-China-Web-Direct'],
          rule: 'AND',
          rulePayload: '((Network,tcp) && (DomainSuffix,baidu.com))',
        }),
      ).route,
    ).toBe('direct')
    expect(
      toActivityRow(
        connection('claude', {
          chains: ['Tono-Home-Residential', 'Tono-Claude-Home'],
        }),
      ).route,
    ).toBe('home')
    expect(
      classifyActivityRoute(
        connection('node', {
          chains: ['Home Residential', 'Tono-Claude-Home'],
        }),
      ),
    ).toBe('home')
  })

  it('does not expose URL credentials, query strings, fragments, or full process paths', () => {
    expect(
      sanitizeActivityValue(
        'https://alice:secret@example.com/private?token=abc#account',
      ),
    ).toBe('example.com')

    const row = toActivityRow(
      connection('private', {
        metadata: {
          ...connection('private').metadata,
          host: 'https://alice:secret@example.com/private?token=abc#account',
          process: '',
        },
        rulePayload: 'https://bob:password@rules.example/list?key=secret',
      }),
    )
    expect(row.target).toBe('example.com:443')
    expect(row.process).toBe('private.exe')
    expect(row.rule).toBe('DOMAIN-SUFFIX (rules.example)')
    expect(JSON.stringify(row)).not.toContain('secret')
    expect(JSON.stringify(row)).not.toContain('private-user')
  })

  it('maps product families without claiming ambiguous Claude executables are Code', () => {
    expect(activityProcessFamily('Cursor.exe')).toBe('Cursor')
    expect(activityProcessFamily('Code.exe')).toBe('Code')
    expect(activityProcessFamily('claude.exe')).toBe('Claude')
    expect(activityProcessFamily('Claude.exe')).toBe('Claude')
    expect(
      toActivityRow(
        connection('cursor', {
          metadata: {
            ...connection('cursor').metadata,
            process: 'Cursor.exe',
            processPath:
              'C:\\Users\\private-user\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
          },
        }),
      ).process,
    ).toBe('Cursor')
  })

  it('groups WeChat helpers as one WeChat app and rejects WeCom', () => {
    expect(isWeChatActivityProcess('WeChatAppEx.exe')).toBe(true)
    expect(isWeChatActivityProcess('xwechat.exe')).toBe(true)
    expect(
      isWeChatActivityProcess(
        'helper.exe',
        'C:\\Program Files\\Tencent\\WeChat\\helper.exe',
      ),
    ).toBe(true)
    expect(isWeChatActivityProcess('WeChatWork.exe')).toBe(false)
    expect(isWeChatActivityProcess('WXWork.exe')).toBe(false)

    const rows = [
      toActivityRow(
        connection('main', {
          metadata: {
            ...connection('main').metadata,
            process: 'WeChat.exe',
            processPath: 'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
          },
        }),
      ),
      toActivityRow(
        connection('helper', {
          metadata: {
            ...connection('helper').metadata,
            process: 'WeChatAppEx.exe',
            processPath: 'C:\\Program Files\\Tencent\\WeChat\\WeChatAppEx.exe',
          },
        }),
      ),
    ]
    expect(rows.every((row) => row.process === WECHAT_ACTIVITY_PROCESS)).toBe(
      true,
    )
    expect(aggregateActivityApps(rows)).toHaveLength(1)
    expect(aggregateActivityApps(rows)[0]?.total).toBe(2)
    expect(rows[1]?.searchText).toContain('wechatappex.exe')
  })
})

describe('Activity app search regressions', () => {
  it('retains every connection search term without changing app totals or exposing private fields', () => {
    const first = connection('first', {
      metadata: { ...connection('first').metadata, process: 'pwsh.exe',
        host: 'https://alice:secret@api.ipify.org/private?token=abc' },
    })
    const second = connection('second', {
      metadata: { ...connection('second').metadata, process: 'pwsh.exe', host: 'second.example.com' },
      chains: ['DIRECT'],
    })
    const apps = aggregateActivityApps([toActivityRow(first), toActivityRow(second)])
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ total: 2, proxied: 1, direct: 1 })
    for (const term of ['api.ipify.org', 'second.example.com', 'https', 'domain-suffix']) {
      expect(apps[0].searchText).toContain(term)
    }
    expect(apps[0].searchText).not.toMatch(/alice|secret|token=|private-user/)
  })

  it('adds WeChat aliases only to actual WeChat process rows', () => {
    const ordinary = toActivityRow(connection('pwsh'))
    expect(ordinary.searchText).not.toMatch(/wechat|weixin|微信/)
    const helper = toActivityRow(connection('helper', {
      metadata: { ...connection('helper').metadata, process: 'WeChatAppEx.exe' },
    }))
    const app = aggregateActivityApps([helper])[0]
    for (const term of ['wechatappex.exe', 'wechat', 'weixin', '微信']) {
      expect(app.searchText).toContain(term)
    }
  })

  it('finds the app by a case-insensitive domain query in the default app view', () => {
    render(<ActivityPage />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PROXY.EXAMPLE.COM' } })
    expect(screen.getByText('proxy.exe')).toBeDefined()
    expect(screen.queryByText('direct.exe')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no-match.example' } })
    expect(screen.queryByText('proxy.exe')).toBeNull()
  })
})

describe('ActivityPage', () => {
  it('subscribes only while the Tono managed runtime is connected', () => {
    tonoStatusMock.uiState = 'notConnected'
    render(<ActivityPage />)

    expect(useConnectionDataMock).toHaveBeenCalledWith({
      enabled: false,
      generation: 7,
    })
    expect(
      screen.getByText('Connect Tono to view live activity.'),
    ).toBeDefined()
    expect(screen.queryByText('proxy.example.com:443')).toBeNull()
    // The controls stay mounted but inert, so a drop mid-session does not wipe
    // the tab and search text the user had chosen.
    const search = screen.getByRole('textbox', {
      name: 'Filter by app, domain, target, protocol, or rule',
    })
    expect(search).toBeDefined()
    expect(search.closest('[aria-disabled="true"]')).not.toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Connections' })
        .closest('[aria-disabled="true"]'),
    ).not.toBeNull()
  })

  it('filters route results and closes one or all live connections', async () => {
    render(<ActivityPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))

    expect(screen.getByText('proxy.example.com:443')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }))
    expect(screen.queryByText('proxy.example.com:443')).toBeNull()
    expect(screen.getByText('direct.example.com:443')).toBeDefined()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close connection to direct.example.com:443',
      }),
    )
    await waitFor(() =>
      expect(closeConnectionMock).toHaveBeenCalledWith('direct', 7),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Close all connections' }),
    )
    await waitFor(() => expect(closeAllConnectionsMock).toHaveBeenCalledWith(7))
  })

  it('says it is reading connections before the first live frame', () => {
    useConnectionDataMock.mockReturnValue({
      response: { data: { activeConnections: [] }, live: false },
      refreshGetClashConnection: vi.fn(),
    })
    render(<ActivityPage />)
    expect(screen.getByText('Reading connections…')).toBeDefined()
  })

  it('retries and names a telemetry miss after the first feed timeout', () => {
    vi.useFakeTimers()
    try {
      const refreshGetClashConnection = vi.fn()
      useConnectionDataMock.mockReturnValue({
        response: { data: { activeConnections: [] }, live: false },
        refreshGetClashConnection,
      })
      render(<ActivityPage />)
      act(() => {
        vi.advanceTimersByTime(4_000)
      })
      expect(
        screen.getByText(
          'The dashboard has not reached the core yet and is retrying. Pages loading still means the tunnel is up.',
        ),
      ).toBeDefined()
      expect(refreshGetClashConnection).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(4_000)
      })
      expect(refreshGetClashConnection).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('explains an empty list when only hidden local DNS is open', () => {
    connectionDataMock.activeConnections = [
      connection('dns', {
        metadata: {
          ...connection('dns').metadata,
          host: '',
          destinationIP: '127.0.0.1',
          destinationPort: '53',
        },
        chains: ['DIRECT'],
        rule: 'IPCIDR',
        rulePayload: '127.0.0.0/8',
      }),
    ]
    render(<ActivityPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(
      screen.getByText('Only local DNS lookups are open; those stay hidden.'),
    ).toBeDefined()
  })
})

describe('Activity apps view filters out hidden local DNS', () => {
  it('hides local-only DNS in the default apps view so the hidden-DNS message replaces ghost rows', () => {
    connectionDataMock.activeConnections = [localDnsConnection('dns')]
    render(<ActivityPage />)
    // Default view is 'apps' — local-only DNS must NOT aggregate into a ghost app row,
    // so the apps view falls into the only-local-DNS empty state instead of a row.
    expect(
      screen.getByText('Only local DNS lookups are open; those stay hidden.'),
    ).toBeDefined()
    expect(screen.queryByText('dns.exe')).toBeNull()
    expect(screen.getByText('0 apps this session')).toBeDefined()
    // Switching to the connections view reaches the same message (unchanged behavior).
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(
      screen.getByText('Only local DNS lookups are open; those stay hidden.'),
    ).toBeDefined()
  })

  it('excludes local DNS from app counts so the count equals the visible split breakdown', () => {
    connectionDataMock.activeConnections = [
      connection('proxy', {
        metadata: {
          ...connection('proxy').metadata,
          process: 'shared.exe',
          processPath: 'C:\\Users\\private-user\\shared.exe',
        },
      }),
      localDnsConnection('dns', {
        metadata: {
          ...localDnsConnection('dns').metadata,
          process: 'shared.exe',
          processPath: 'C:\\Users\\private-user\\shared.exe',
        },
      }),
    ]
    render(<ActivityPage />)
    // One proxied flow aggregates into total = 1 — the loopback DNS row is hidden,
    // so the count column must read 1 (not 2 as it did before the fix).
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.queryByText('2')).toBeNull()
    // The split bar's title covers only the proxied flow; the count and the bar sum agree.
    expect(
      screen.getByTitle('0 direct · 0 home · 1 cloud · 0 rejected'),
    ).toBeDefined()
    expect(screen.getByText('1 apps this session')).toBeDefined()
  })

  it('keeps the apps aggregated total independent of the selected route filter', () => {
    const shared = (overrides: Partial<IConnectionsItem> = {}) =>
      connection('shared', {
        metadata: {
          ...connection('shared').metadata,
          process: 'shared.exe',
          processPath: 'C:\\Users\\private-user\\shared.exe',
        },
        ...overrides,
      })
    connectionDataMock.activeConnections = [
      shared({ chains: ['DIRECT'] }),
      shared(),
      localDnsConnection('local', {
        metadata: {
          ...localDnsConnection('local').metadata,
          process: 'shared.exe',
          processPath: 'C:\\Users\\private-user\\shared.exe',
        },
      }),
    ]
    render(<ActivityPage />)
    // Default 'All': aggregation already excludes local — count is direct + proxied = 2,
    // and the split bar covers both routes.
    expect(screen.getByText('2')).toBeDefined()
    expect(
      screen.getByTitle('1 direct · 0 home · 1 cloud · 0 rejected'),
    ).toBeDefined()

    // Switching to 'Cloud' admits the app (its proxied > 0) but the count and the split
    // bar are unchanged. Aggregating the connection list by the route filter (visibleRows)
    // would zero out `direct` here, diverging apps-view behavior from connections-view.
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }))
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.queryByText('1')).toBeNull()
    expect(
      screen.getByTitle('1 direct · 0 home · 1 cloud · 0 rejected'),
    ).toBeDefined()

    // Switching to 'Direct' admits the same app; the proxied bar segment survives.
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }))
    expect(screen.getByText('2')).toBeDefined()
    expect(
      screen.getByTitle('1 direct · 0 home · 1 cloud · 0 rejected'),
    ).toBeDefined()

    // 'Rejected' admits no apps (the rejected segment is zero) and lands on the no-matches
    // empty state without changing what was aggregated in any other filter state.
    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }))
    expect(
      screen.getByText('No connections match these filters.'),
    ).toBeDefined()
  })
})
