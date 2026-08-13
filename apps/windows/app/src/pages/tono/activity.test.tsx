// @vitest-environment jsdom
import {
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

beforeEach(() => {
  closeConnectionMock.mockReset().mockResolvedValue(undefined)
  closeAllConnectionsMock.mockReset().mockResolvedValue(undefined)
  tonoStatusMock.uiState = 'connected'
  useConnectionDataMock
    .mockReset()
    .mockReturnValue({ response: { data: connectionDataMock } })
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
        connection('node', { chains: ['Home Residential', 'Tono-Claude-Home'] }),
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
            processPath:
              'C:\\Program Files\\Tencent\\WeChat\\WeChatAppEx.exe',
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

    const search = screen.getByRole('textbox', {
      name: 'Filter by app, domain, target, protocol, or rule',
    })
    const searchIcon = search.closest('label')?.querySelector('svg')
    expect(searchIcon).not.toBeNull()
    expect(searchIcon?.style.width).toBe('18px')
    expect(searchIcon?.style.height).toBe('18px')
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

    fireEvent.click(screen.getByRole('button', { name: 'Close All' }))
    await waitFor(() => expect(closeAllConnectionsMock).toHaveBeenCalledWith(7))
  })
})
