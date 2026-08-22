import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { VirtualList } from '@/components/base/virtual-list'
import { useConnectionData } from '@/hooks/use-connection-data'
import { useTonoStatus } from '@/hooks/use-tono'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import { tonoCloseAllConnections, tonoCloseConnection } from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  TONO_COLORS,
  TONO_MONO_STACK,
  TONO_PAGE_LAYOUT,
  tonoText,
} from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'

import {
  aggregateActivityApps,
  type ActivityRoute,
  WECHAT_ACTIVITY_PROCESS,
  toActivityRow,
} from './activity-model'

type ActivityFilter = 'all' | ActivityRoute
type ActivityView = 'apps' | 'connections'

const MAX_ACTIVITY_CONNECTIONS = 2_000
const EMPTY_CONNECTIONS: IConnectionsItem[] = []
const FILTERS: ActivityFilter[] = ['all', 'proxied', 'home', 'direct', 'rejected']
const ACTIVITY_GRID_COLUMNS =
  'minmax(120px, 1.1fr) minmax(150px, 1.4fr) 90px 88px minmax(110px, 1fr) 34px'

const ACTIVITY_APP_KEYS: Record<string, string> = {
  [WECHAT_ACTIVITY_PROCESS]: 'tono.activity.apps.wechat',
  WXWork: 'tono.activity.apps.wecom',
  WeCom: 'tono.activity.apps.wecom',
  QQ: 'tono.activity.apps.qq',
  TIM: 'tono.activity.apps.tim',
  Feishu: 'tono.activity.apps.feishu',
  Lark: 'tono.activity.apps.feishu',
  WeMeetApp: 'tono.activity.apps.meeting',
  TencentMeeting: 'tono.activity.apps.meeting',
  Claude: 'tono.activity.apps.claude',
  claude: 'tono.activity.apps.claude',
  ClaudeCode: 'tono.activity.apps.claudeCode',
  ChatGPT: 'tono.activity.apps.chatgpt',
  chatgpt: 'tono.activity.apps.chatgpt',
  Grok: 'tono.activity.apps.grok',
  grok: 'tono.activity.apps.grok',
  Cursor: 'tono.activity.apps.cursor',
  cursor: 'tono.activity.apps.cursor',
  Code: 'tono.activity.apps.vscode',
  chrome: 'tono.activity.apps.chrome',
  Chrome: 'tono.activity.apps.chrome',
}

const activityProcessLabel = (
  process: string,
  translate: (key: string) => string,
) => {
  const key = ACTIVITY_APP_KEYS[process]
  return key ? translate(key) : process
}

const RouteBadge = ({ route }: { route: ActivityRoute }) => {
  const { t } = useTranslation()
  const color =
    route === 'proxied'
      ? TONO_COLORS.accent
      : route === 'home'
        ? TONO_COLORS.accentWarm
        : route === 'direct'
          ? TONO_COLORS.connected
          : TONO_COLORS.error
  return (
    <span
      style={{
        borderRadius: 8,
        padding: '4px 8px',
        color,
        background: `${color}1A`,
        fontSize: 11,
        fontWeight: 650,
        whiteSpace: 'nowrap',
      }}
    >
      {t(`tono.activity.routes.${route}`)}
    </span>
  )
}

const ActivityPage = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const connected = status?.uiState === 'connected'
  const generation = status?.controllerGeneration
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [view, setView] = useState<ActivityView>('apps')
  const [query, setQuery] = useState('')
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closingAll, setClosingAll] = useState(false)
  const {
    response: { data },
  } = useConnectionData({ enabled: connected, generation })

  const activeConnections = data?.activeConnections ?? EMPTY_CONNECTIONS
  const capped = useMemo(
    () => activeConnections.slice(0, MAX_ACTIVITY_CONNECTIONS),
    [activeConnections],
  )
  const rows = useMemo(() => capped.map(toActivityRow), [capped])
  const normalizedQuery = query.trim().toLowerCase()
  const appRows = useMemo(() => aggregateActivityApps(rows), [rows])
  const visibleApps = useMemo(
    () =>
      appRows.filter((row) => {
        if (normalizedQuery && !row.searchText.includes(normalizedQuery)) {
          return false
        }
        if (filter === 'all') return row.total > 0
        return row[filter] > 0
      }),
    [appRows, filter, normalizedQuery],
  )
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          // Local rows (loopback DNS etc.) are pure noise — every app generates
          // them constantly and they read as fake DIRECT leaks.
          row.route !== 'local' &&
          (filter === 'all' || row.route === filter) &&
          (!normalizedQuery || row.searchText.includes(normalizedQuery)),
      ),
    [filter, normalizedQuery, rows],
  )

  const handleClose = useCallback(
    async (id: string) => {
      setClosingId(id)
      try {
        if (generation == null) throw new Error('controller unavailable')
        await tonoCloseConnection(id, generation)
      } catch {
        showNotice.error('tono.activity.closeFailed')
      } finally {
        setClosingId(null)
      }
    },
    [generation],
  )

  const handleCloseAll = useCallback(async () => {
    setClosingAll(true)
    try {
      if (generation == null) throw new Error('controller unavailable')
      await tonoCloseAllConnections(generation)
    } catch {
      showNotice.error('tono.activity.closeAllFailed')
    } finally {
      setClosingAll(false)
    }
  }, [generation])

  const renderRow = useCallback(
    (index: number) => {
      const row = visibleRows[index]
      return (
        <div
          role="listitem"
          className="tono-activity-row"
          data-testid={`activity-row-${row.id}`}
          style={{
            minHeight: 74,
            boxSizing: 'border-box',
            display: 'grid',
            gridTemplateColumns: ACTIVITY_GRID_COLUMNS,
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(30,42,70,0.08)'}`,
            color: text.primary,
          }}
        >
          <span style={{ minWidth: 0 }}>
            <strong
              title={activityProcessLabel(row.process, t)}
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
              }}
            >
              {activityProcessLabel(row.process, t)}
            </strong>
          </span>
          <span
            title={row.target}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: TONO_MONO_STACK,
              fontSize: 12,
            }}
          >
            {row.target}
          </span>
          <span
            style={{
              color: text.secondary,
              fontFamily: TONO_MONO_STACK,
              fontSize: 11,
            }}
          >
            {row.protocol}
          </span>
          <RouteBadge route={row.route} />
          <span
            className="tono-activity-rule"
            title={row.rule}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: text.secondary,
              fontSize: 11,
            }}
          >
            {row.rule}
          </span>
          <button
            type="button"
            className="tono-link"
            aria-label={t('tono.activity.closeConnection', {
              target: row.target,
            })}
            disabled={closingId === row.id || closingAll}
            onClick={() => void handleClose(row.id)}
            style={{ width: 30, height: 30, color: text.secondary }}
          >
            <TonoIcon name="close" size={16} />
          </button>
        </div>
      )
    },
    [
      closingAll,
      closingId,
      dark,
      handleClose,
      t,
      text.primary,
      text.secondary,
      visibleRows,
    ],
  )

  return (
    <div
      className="tono-page"
      style={{
        ...TONO_PAGE_LAYOUT,
        height: '100%',
        minHeight: 520,
        overflow: 'hidden',
        gap: 18,
      }}
    >
      <PageHeader
        title={t('tono.activity.title')}
        subtitle={t('tono.activity.subtitle')}
        trailing={
          <button
            type="button"
            className="tono-button"
            disabled={!connected || activeConnections.length === 0 || closingAll}
            title={t('tono.activity.closeAllHint')}
            onClick={() => void handleCloseAll()}
            style={{
              padding: '8px 13px',
              color: '#fff',
              background: TONO_COLORS.error,
            }}
          >
            {closingAll
              ? t('tono.activity.closingAll')
              : t('tono.activity.closeAll')}
          </button>
        }
      />

      <GlassCard
        radius="var(--tono-radius-card)"
        padding={0}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {connected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 14,
            borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(30,42,70,0.08)'}`,
          }}
        >
          <label style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <TonoIcon
              name="search"
              size={18}
              style={{
                // Keep the search glyph absolutely sized even if a stylesheet
                // fails to load — a CSP regression once expanded this SVG
                // across the Activity card.
                width: 18,
                height: 18,
                position: 'absolute',
                left: 11,
                top: 9,
                color: text.tertiary,
                pointerEvents: 'none',
              }}
            />
            <input
              className="tono-input"
              aria-label={t('tono.activity.search')}
              placeholder={t('tono.activity.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{
                padding: '9px 12px 9px 38px',
                color: text.primary,
                border: `1px solid ${dark ? 'rgba(255,255,255,0.13)' : 'rgba(30,42,70,0.12)'}`,
                background: dark
                  ? 'rgba(255,255,255,0.055)'
                  : 'rgba(255,255,255,0.7)',
              }}
            />
          </label>
          <div
            role="group"
            aria-label={t('tono.activity.view')}
            style={{ display: 'flex', gap: 4 }}
          >
            {(['apps', 'connections'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="tono-button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                style={{
                  minHeight: 34,
                  padding: '6px 10px',
                  fontSize: 11,
                  color: view === value ? '#fff' : text.secondary,
                  background:
                    view === value
                      ? TONO_COLORS.accent
                      : dark
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(30,42,70,0.06)',
                }}
              >
                {t(`tono.activity.views.${value}`)}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label={t('tono.activity.routeFilter')}
            style={{ display: 'flex', gap: 4 }}
          >
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className="tono-button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                style={{
                  minHeight: 34,
                  padding: '6px 10px',
                  fontSize: 11,
                  color: filter === value ? '#fff' : text.secondary,
                  background:
                    filter === value
                      ? TONO_COLORS.accent
                      : dark
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(30,42,70,0.06)',
                }}
              >
                {t(`tono.activity.filters.${value}`)}
              </button>
            ))}
          </div>
        </div>
        )}

        {!connected ? (
          <div
            style={{
              margin: 'auto',
              padding: 28,
              textAlign: 'center',
              color: text.secondary,
            }}
          >
            {t('tono.activity.disconnected')}
          </div>
        ) : (view === 'apps' ? visibleApps.length : visibleRows.length) ===
          0 ? (
          <div
            style={{
              margin: 'auto',
              padding: 28,
              textAlign: 'center',
              color: text.secondary,
            }}
          >
            {t(
              normalizedQuery || filter !== 'all'
                ? 'tono.activity.noMatches'
                : 'tono.activity.empty',
            )}
          </div>
        ) : (
          <>
            {view === 'apps' ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(140px, 1.2fr) 72px minmax(160px, 1.6fr)',
                    gap: 12,
                    padding: '9px 14px',
                    color: text.tertiary,
                    fontSize: 10,
                    fontWeight: 650,
                    letterSpacing: 0.25,
                    textTransform: 'uppercase',
                  }}
                >
                  <span>{t('tono.activity.columns.process')}</span>
                  <span>{t('tono.activity.columns.count')}</span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span>{t('tono.activity.columns.split')}</span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        textTransform: 'none',
                        letterSpacing: 0,
                        fontWeight: 600,
                        fontSize: 10,
                      }}
                    >
                      {(
                        [
                          ['direct', TONO_COLORS.connected],
                          ['home', TONO_COLORS.accentWarm],
                          ['proxied', TONO_COLORS.accent],
                          ['rejected', TONO_COLORS.error],
                        ] as const
                      ).map(([key, color]) => (
                        <span
                          key={key}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: text.secondary,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 7,
                              height: 4,
                              borderRadius: 2,
                              background: color,
                            }}
                          />
                          {t(`tono.activity.filters.${key}`)}
                        </span>
                      ))}
                    </span>
                  </span>
                </div>
                <VirtualList
                  count={visibleApps.length}
                  estimateSize={64}
                  overscan={8}
                  getItemKey={(index) => visibleApps[index].process}
                  renderItem={(index) => {
                    const app = visibleApps[index]
                    const bar = (count: number, color: string) => (
                      <span
                        style={{
                          height: 6,
                          flex: Math.max(count, 0),
                          background: color,
                          borderRadius: 99,
                        }}
                      />
                    )
                    return (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'minmax(140px, 1.2fr) 72px minmax(160px, 1.6fr)',
                          gap: 12,
                          alignItems: 'center',
                          padding: '10px 14px',
                          color: text.primary,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {activityProcessLabel(app.process, t)}
                        </span>
                        <span style={{ fontFamily: TONO_MONO_STACK }}>
                          {app.total}
                        </span>
                        <span
                          style={{ display: 'flex', gap: 3, minWidth: 0 }}
                          title={t('tono.activity.splitHint', {
                            direct: app.direct,
                            home: app.home,
                            proxied: app.proxied,
                            rejected: app.rejected,
                          })}
                        >
                          {bar(app.direct, TONO_COLORS.connected)}
                          {bar(app.home, TONO_COLORS.accentWarm)}
                          {bar(app.proxied, TONO_COLORS.accent)}
                          {bar(app.rejected, TONO_COLORS.error)}
                        </span>
                      </div>
                    )
                  }}
                  style={{ flex: 1, minHeight: 0 }}
                />
              </>
            ) : (
              <>
                <div
                  className="tono-activity-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: ACTIVITY_GRID_COLUMNS,
                    gap: 12,
                    padding: '9px 14px',
                    color: text.tertiary,
                    fontSize: 10,
                    fontWeight: 650,
                    letterSpacing: 0.25,
                    textTransform: 'uppercase',
                  }}
                >
                  <span>{t('tono.activity.columns.process')}</span>
                  <span>{t('tono.activity.columns.target')}</span>
                  <span>{t('tono.activity.columns.protocol')}</span>
                  <span>{t('tono.activity.columns.route')}</span>
                  <span className="tono-activity-rule">
                    {t('tono.activity.columns.rule')}
                  </span>
                  <span />
                </div>
                <VirtualList
                  count={visibleRows.length}
                  estimateSize={74}
                  overscan={8}
                  getItemKey={(index) => visibleRows[index].id}
                  renderItem={renderRow}
                  style={{ flex: 1, minHeight: 0 }}
                />
              </>
            )}
          </>
        )}
        <div
          style={{
            padding: '8px 14px',
            borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(30,42,70,0.08)'}`,
            color: text.tertiary,
            fontSize: 11,
          }}
        >
          {view === 'apps'
            ? t('tono.activity.appCount', { count: visibleApps.length })
            : t('tono.activity.connectionCount', { count: visibleRows.length })}
          {activeConnections.length > MAX_ACTIVITY_CONNECTIONS &&
            ` · ${t('tono.activity.limitNotice', { count: MAX_ACTIVITY_CONNECTIONS })}`}
        </div>
      </GlassCard>
    </div>
  )
}

export default ActivityPage
