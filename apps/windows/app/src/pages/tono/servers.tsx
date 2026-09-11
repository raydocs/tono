import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { tonoServersQueryKey, useTonoStatus } from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  idleSelectShouldConnect,
  isSupersededConnectRejection,
  tonoCancelServerTests,
  tonoCatalogStatus,
  tonoConnect,
  tonoRefreshCatalog,
  tonoSelectServer,
  tonoServers,
  tonoTestAvailableServers,
  tonoTestCurrentServer,
} from '@/services/tono'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  TONO_COLORS,
  TONO_EASE,
  TONO_MONO_STACK,
  tonoText,
} from '@/tono-ui/theme'
import { useTonoToast } from '@/tono-ui/tono-toast-context'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoNodeBadge } from '@/tono-ui/TonoNodeBadge'

import {
  latencyColor,
  latencyLabelKey,
  latencyLabelVars,
  readNodeLatency,
} from './node-latency'
import {
  nodeCityLabel,
  nodeCityParts,
  nodeCode,
  nodeDisplayName,
  nodeProtocolKey,
} from './node-meta'

const catalogStatusQueryKey = ['tono', 'catalog-status'] as const

type EndpointTestState = {
  revision: number | null
  latencies: Record<string, number>
  failures: Record<string, 'timeout' | 'failed'>
}

const hex = (color: string, alpha: number) =>
  `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`

const TonoTestIcon = () => <TonoIcon name="bolt" size={13} />

const SERVER_SKELETONS = ['sk-a', 'sk-b', 'sk-c', 'sk-d'] as const

const ServersPage = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()
  const showToast = useTonoToast()
  const [selectError, setSelectError] = useState<string | null>(null)
  const [switchingName, setSwitchingName] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [regionFilter, setRegionFilter] = useState<string | null>(null)
  const cancelRequestedRef = useRef(false)
  const [currentExitTest, setCurrentExitTest] = useState<{
    name: string
    latency: number
  } | null>(null)
  const [endpointTests, setEndpointTests] = useState<EndpointTestState>({
    revision: null,
    latencies: {},
    failures: {},
  })

  const {
    data: servers,
    error: serversError,
    isFetching: fetchingServers,
    refetch: mutateServers,
  } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
  })
  const { data: catalog, refetch: mutateCatalog } = useQuery({
    queryKey: catalogStatusQueryKey,
    queryFn: tonoCatalogStatus,
    refetchInterval: 30_000,
  })

  useEffect(
    () => () => {
      void tonoCancelServerTests().catch(() => {})
    },
    [],
  )

  const handleSelect = useLockFn(
    async (name: string, selected: boolean, available: boolean) => {
      if (!available) {
        setSelectError(t('tono.nodes.unavailableHint'))
        return
      }
      // Same-city reselect is a no-op while a tunnel is up. After a released
      // handshake eof the card is still selected and says Connecting; a tap
      // must Connect, matching macOS selectNode. Otherwise Choose another
      // route lands here and the failed city looks dead.
      if (selected) {
        if (!idleSelectShouldConnect(status?.uiState)) return
        setSelectError(null)
        setSwitchingName(name)
        try {
          await tonoConnect()
          await mutateTonoStatus()
        } catch (error) {
          if (!isSupersededConnectRejection(error)) {
            setSelectError(formatTonoActionError(error, t))
          }
        } finally {
          setSwitchingName(null)
        }
        return
      }
      setSelectError(null)
      setSwitchingName(name)
      try {
        await tonoSelectServer(name)
        // First-connect handshake eof fully releases protection, so select
        // is UpdateOnly. The card already says Connecting; actually connect.
        if (idleSelectShouldConnect(status?.uiState)) await tonoConnect()
        await Promise.all([mutateServers(), mutateTonoStatus()])
        // Announce the localized city the card shows, not the raw wire name —
        // otherwise the toast says "Tokyo · Dawn" over a card labelled 东京.
        showToast(
          t('tono.nodes.switchedTo', {
            name: nodeCityLabel(name, t),
          }),
        )
      } catch (error) {
        if (!isSupersededConnectRejection(error)) {
          setSelectError(formatTonoActionError(error, t))
        }
      } finally {
        setSwitchingName(null)
      }
    },
  )

  const handleTestCurrent = useLockFn(async () => {
    if (!selected) return
    setTesting(true)
    setSelectError(null)
    try {
      const latency = await tonoTestCurrentServer()
      setCurrentExitTest({ name: selected.name, latency })
    } catch (error) {
      setSelectError(formatTonoActionError(error, t))
    } finally {
      setTesting(false)
    }
  })

  const handleTestAll = useLockFn(async () => {
    setTestingAll(true)
    cancelRequestedRef.current = false
    setSelectError(null)
    try {
      const results = await tonoTestAvailableServers()
      setEndpointTests({
        revision: catalog?.revision ?? null,
        latencies: Object.fromEntries(
          results.flatMap((result) =>
            result.latencyMs === null ? [] : [[result.name, result.latencyMs]],
          ),
        ),
        failures: Object.fromEntries(
          results
            .filter((result) => result.latencyMs === null)
            .map((result) => [
              result.name,
              result.error === 'timeout' ? 'timeout' : 'failed',
            ]),
        ),
      })
    } catch (error) {
      if (!cancelRequestedRef.current) {
        setSelectError(formatTonoActionError(error, t))
      }
    } finally {
      setTestingAll(false)
      cancelRequestedRef.current = false
    }
  })

  const handleCancelTests = async () => {
    cancelRequestedRef.current = true
    await tonoCancelServerTests()
  }

  const handleRefresh = useLockFn(async () => {
    setRefreshing(true)
    setRefreshFeedback(null)
    setSelectError(null)
    try {
      await tonoRefreshCatalog()
      await Promise.all([mutateServers(), mutateCatalog(), mutateTonoStatus()])
      setRefreshFeedback(t('tono.nodes.refreshSuccess'))
    } catch (error) {
      setSelectError(formatTonoActionError(error, t))
      await mutateCatalog()
    } finally {
      setRefreshing(false)
    }
  })

  const selected = (servers ?? []).find((server) => server.selected)
  const query = searchText.trim().toLowerCase()
  const visibleServers = useMemo(() => {
    return (servers ?? []).filter((server) => {
      const display = nodeDisplayName(server.name)
      const parts = nodeCityParts(server.name)
      const matchesQuery =
        !query ||
        display.toLowerCase().includes(query) ||
        server.name.toLowerCase().includes(query) ||
        parts.city.toLowerCase().includes(query) ||
        (parts.codename?.toLowerCase().includes(query) ?? false) ||
        t(nodeProtocolKey(server.name)).toLowerCase().includes(query)
      const matchesRegion =
        !regionFilter || nodeCode(server.name) === regionFilter
      return matchesQuery && matchesRegion
    })
  }, [query, regionFilter, servers, t])
  const regionOptions = useMemo(() => {
    return Array.from(
      new Set((servers ?? []).map((server) => nodeCode(server.name))),
    ).sort()
  }, [servers])
  // zh already has 美国 / 日本 for these, but the chips and group headers
  // rendered the raw ISO code, so a Chinese customer read "US" and "JP" while
  // the translations sat unused. An unknown code falls back to itself.
  const regionLabel = useCallback(
    (code: string) => {
      const key = `tono.nodes.regions.${code.toLowerCase()}`
      const translated = t(key)
      return translated === key ? code : translated
    },
    [t],
  )
  const serverGroups = useMemo(() => {
    const usable = visibleServers.filter((server) => server.available !== false)
    const codes = Array.from(
      new Set(usable.map((server) => nodeCode(server.name))),
    ).sort()
    return [
      ...codes.map((code) => ({
        key: code,
        label: regionLabel(code),
        servers: usable.filter((server) => nodeCode(server.name) === code),
      })),
      {
        key: 'unavailable',
        label: t('tono.nodes.regions.unavailable'),
        servers: visibleServers.filter((server) => server.available === false),
      },
    ].filter((group) => group.servers.length > 0)
  }, [t, regionLabel, visibleServers])
  const canTestAll =
    status?.uiState === 'notConnected' &&
    catalog?.revision !== null &&
    catalog?.revision !== undefined &&
    (servers ?? []).some((server) => server.available !== false)

  return (
    <div className="tono-page">
      <PageHeader
        title={t('tono.nodes.title')}
        subtitle={t('tono.nodes.subtitle')}
        trailing={
          <>
            <button
              type="button"
              className="tono-button"
              onClick={testingAll ? handleCancelTests : handleTestAll}
              disabled={testing || (!testingAll && !canTestAll)}
              style={{
                padding: '8px 14px',
                color: text.primary,
                background: dark
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.62)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
              }}
            >
              <TonoTestIcon />
              {testingAll
                ? t('tono.nodes.cancelTest')
                : t('tono.nodes.testAll')}
            </button>
            <button
              type="button"
              className="tono-button"
              onClick={handleTestCurrent}
              disabled={
                testing ||
                testingAll ||
                !selected ||
                status?.uiState !== 'connected'
              }
              style={{
                padding: '8px 14px',
                color: text.primary,
                background: dark
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.62)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
              }}
            >
              <TonoTestIcon />
              {testing ? '…' : t('tono.nodes.testCurrent')}
            </button>
          </>
        }
      />

      <div
        style={{
          marginBottom: 18,
          padding: '12px 14px',
          borderRadius: 16,
          color: text.secondary,
          background: dark ? 'rgba(16,21,33,0.55)' : 'rgba(255,255,255,0.62)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(56,72,108,0.08)'}`,
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 10,
                flexShrink: 0,
                color: TONO_COLORS.latencyGood,
                background: hex(TONO_COLORS.latencyGood, dark ? 0.18 : 0.14),
              }}
            >
              <TonoIcon name="shieldCheck" size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: 13, fontWeight: 650, color: text.primary }}
              >
                {t('tono.nodes.catalogNodes', {
                  count: catalog?.nodeCount ?? (servers ?? []).length,
                })}
                {' · '}
                {t('tono.nodes.catalogSynced')}
              </div>
              <div
                style={{
                  marginTop: 2,
                  color: text.tertiary,
                  fontSize: 11,
                  lineHeight: 1.45,
                }}
              >
                {catalog?.lastSyncedAtMs
                  ? t('tono.nodes.lastSynced', {
                      time: dayjs(catalog.lastSyncedAtMs).format(
                        'YYYY-MM-DD HH:mm',
                      ),
                    })
                  : t('tono.nodes.waitingForSync')}
                {' · '}
                <span style={{ fontFamily: TONO_MONO_STACK }}>
                  v{catalog?.revision ?? '—'}
                </span>
                {' · '}
                {t('tono.nodes.verifiedSyncHint')}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="tono-button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || status?.accountState !== 'ready'}
            style={{
              padding: '7px 12px',
              fontSize: 11,
              color: text.primary,
              background: dark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(255,255,255,0.55)',
            }}
          >
            {refreshing ? t('tono.nodes.refreshing') : t('tono.nodes.refresh')}
          </button>
        </div>
        {(catalog?.error || refreshFeedback) && (
          <div
            role={catalog?.error ? 'alert' : 'status'}
            style={{
              marginTop: 7,
              color: catalog?.error
                ? 'var(--tono-text-error)'
                : TONO_COLORS.latencyGood,
            }}
          >
            {catalog?.error
              ? t('tono.nodes.catalogError', {
                  error: formatTonoActionError(catalog.error, t),
                })
              : refreshFeedback}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <label
          className="tono-search"
          style={{
            flex: 1,
            minWidth: 180,
            color: text.secondary,
            background: dark
              ? 'rgba(255,255,255,0.07)'
              : 'rgba(255,255,255,0.42)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
          }}
        >
          <TonoIcon name="search" size={14} />
          <input
            className="tono-input"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('tono.nodes.search')}
            aria-label={t('tono.nodes.search')}
            style={{
              padding: '8px 0',
              border: 'none',
              background: 'transparent',
              color: text.primary,
            }}
          />
        </label>
        {/* biome-ignore lint/a11y/useSemanticElements: chip row is a filter toolbar, not a form fieldset */}
        <div
          className="tono-chip-row"
          role="group"
          aria-label={t('tono.nodes.regions.all')}
          style={{
            background: dark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(255,255,255,0.32)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(56,72,108,0.1)'}`,
          }}
        >
          <button
            type="button"
            className="tono-chip"
            aria-pressed={regionFilter === null}
            onClick={() => setRegionFilter(null)}
            style={{
              color: regionFilter === null ? '#fff' : text.secondary,
              background:
                regionFilter === null ? TONO_COLORS.accent : 'transparent',
            }}
          >
            {t('tono.nodes.regions.all')}
          </button>
          {regionOptions.map((code) => (
            <button
              key={code}
              type="button"
              className="tono-chip"
              aria-pressed={regionFilter === code}
              onClick={() => setRegionFilter(code)}
              style={{
                color: regionFilter === code ? '#fff' : text.secondary,
                background:
                  regionFilter === code ? TONO_COLORS.accent : 'transparent',
              }}
            >
              {regionLabel(code)}
            </button>
          ))}
        </div>
      </div>

      {selectError && (
        <p
          role="alert"
          style={{
            margin: '0 0 8px',
            fontSize: 12,
            color: 'var(--tono-text-error)',
          }}
        >
          {selectError}
        </p>
      )}

      {serversError && (
        <div
          role="alert"
          style={{
            marginBottom: 8,
            fontSize: 13,
            color: 'var(--tono-text-error)',
          }}
        >
          <p>{formatTonoActionError(serversError, t)}</p>
          <button
            type="button"
            className="tono-button"
            disabled={fetchingServers}
            style={{
              padding: '7px 12px',
              color: text.primary,
              background: dark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(255,255,255,0.55)',
            }}
            onClick={() =>
              void mutateServers().catch(() => {
                // The query retains the latest error for the alert above.
              })
            }
          >
            {t('shared.actions.retry')}
          </button>
        </div>
      )}

      {servers === undefined ? (
        !serversError && (
          <div
            className="tono-server-grid"
            aria-busy="true"
            role="status"
            aria-label={t('shared.statuses.loading')}
          >
            {SERVER_SKELETONS.map((id) => (
              <div
                key={id}
                className="tono-server-skeleton tono-rise-in"
                style={{
                  minHeight: 126,
                  borderRadius: 18,
                  background: 'var(--tono-surface-raised)',
                }}
              />
            ))}
          </div>
        )
      ) : servers.length === 0 ? (
        <div
          className="tono-empty"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '48px 16px',
            textAlign: 'center',
            color: text.secondary,
            fontSize: 13,
          }}
        >
          <TonoIcon name="globe" size={28} />
          <p style={{ margin: 0 }}>{t('tono.nodes.empty')}</p>
        </div>
      ) : visibleServers.length === 0 ? (
        <div
          className="tono-empty"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '48px 16px',
            textAlign: 'center',
            color: text.secondary,
            fontSize: 13,
          }}
        >
          <TonoIcon name="search" size={28} />
          <p style={{ margin: 0 }}>{t('tono.nodes.noMatches')}</p>
          <button
            type="button"
            className="tono-button"
            onClick={() => {
              setSearchText('')
              setRegionFilter(null)
            }}
            style={{
              padding: '8px 14px',
              color: text.primary,
              background: dark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(255,255,255,0.62)',
              border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
            }}
          >
            {t('tono.nodes.regions.all')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {serverGroups.map((group) => (
            <section key={group.key}>
              <div
                style={{
                  marginBottom: 8,
                  color: text.tertiary,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.35,
                  textTransform: 'uppercase',
                }}
              >
                {group.key === 'unavailable'
                  ? t('tono.nodes.regions.unavailable')
                  : group.label}
              </div>
              {group.key === 'unavailable' && (
                <p
                  style={{
                    margin: '-2px 0 9px',
                    color: text.tertiary,
                    fontSize: 11,
                  }}
                >
                  {t('tono.nodes.unavailableHint')}
                </p>
              )}
              <div className="tono-server-grid">
                {group.servers.map((server) => {
                  const endpointTestsCurrent =
                    endpointTests.revision === (catalog?.revision ?? null)
                  const endpointLatency = endpointTestsCurrent
                    ? endpointTests.latencies[server.name]
                    : undefined
                  const endpointFailure = endpointTestsCurrent
                    ? endpointTests.failures[server.name]
                    : undefined
                  const exitLatency =
                    currentExitTest?.name === server.name
                      ? currentExitTest.latency
                      : server.selected &&
                          status?.exitDelayMs &&
                          status.exitDelayMs > 0
                        ? status.exitDelayMs
                        : undefined
                  const cachedLatency = readNodeLatency(server.name)
                  const latency =
                    endpointLatency ?? exitLatency ?? cachedLatency
                  const latencyLabel =
                    endpointLatency !== undefined
                      ? t(
                          latencyLabelKey('tcp', endpointLatency),
                          latencyLabelVars(endpointLatency),
                        )
                      : exitLatency !== undefined
                        ? t(
                            latencyLabelKey('exit', exitLatency),
                            latencyLabelVars(exitLatency),
                          )
                        : cachedLatency !== null
                          ? t(
                              latencyLabelKey('cached', cachedLatency),
                              latencyLabelVars(cachedLatency),
                            )
                          : t('tono.nodes.untested')
                  const available = server.available !== false
                  const latencyTone =
                    !available || endpointFailure
                      ? TONO_COLORS.error
                      : latency !== null
                        ? latencyColor(
                            latency,
                            endpointLatency !== undefined
                              ? 'tcp'
                              : exitLatency !== undefined
                                ? 'exit'
                                : 'cached',
                          )
                        : text.tertiary
                  const latencyHasTone =
                    !available ||
                    endpointFailure !== undefined ||
                    latency !== null
                  const cardStatus = !available
                    ? t('tono.nodes.unavailable')
                    : endpointFailure === 'timeout'
                      ? t('tono.nodes.timeout')
                      : endpointFailure
                        ? t('tono.nodes.testFailed')
                        : server.selected
                          ? t('tono.node.activeServer')
                          : t('tono.nodes.readyToConnect')
                  // Same label as the tray / dashboard: hy2 is "Tokyo · Backup
                  // channel", not a second identical 东京 card. Choose-another-route
                  // after a handshake eof has to be distinguishable at a glance.
                  const cityTitle = nodeCityLabel(server.name, t)
                  const latencyText = !available
                    ? t('tono.nodes.unavailable')
                    : endpointFailure === 'timeout'
                      ? t('tono.nodes.timeout')
                      : endpointFailure
                        ? t('tono.nodes.testFailed')
                        : latencyLabel
                  const isSwitchingCard = switchingName === server.name
                  const othersLocked =
                    switchingName !== null && switchingName !== server.name
                  const cardDisabled = !available || othersLocked
                  const highlighted =
                    isSwitchingCard ||
                    (server.selected && switchingName === null)
                  // One sentence for assistive tech, in the order the card
                  // reads: city, region, measurement, state. The macOS card
                  // has the same summary (localNodeAccessibilitySummary).
                  const cardSummary = [
                    cityTitle,
                    t(nodeProtocolKey(server.name)),
                    regionLabel(nodeCode(server.name)),
                    latencyText,
                    cardStatus,
                  ].join(', ')
                  return (
                    <button
                      key={server.name}
                      type="button"
                      className="tono-server-card"
                      aria-label={cardSummary}
                      disabled={cardDisabled}
                      onClick={() =>
                        void handleSelect(
                          server.name,
                          server.selected,
                          available,
                        )
                      }
                      style={{
                        position: 'relative',
                        overflow: 'visible',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        justifyContent: 'space-between',
                        display: 'flex',
                        gap: 14,
                        minHeight: 126,
                        padding: '16px 16px 14px',
                        borderRadius: 18,
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        cursor: cardDisabled
                          ? 'not-allowed'
                          : highlighted
                            ? 'default'
                            : 'pointer',
                        opacity: cardDisabled ? 0.55 : 1,
                        color: text.primary,
                        background: highlighted
                          ? hex(TONO_COLORS.accent, dark ? 0.13 : 0.08)
                          : dark
                            ? 'rgba(16,21,33,0.72)'
                            : 'rgba(255,255,255,0.76)',
                        border: highlighted
                          ? `1px solid ${hex(TONO_COLORS.accent, 0.55)}`
                          : `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(56,72,108,0.09)'}`,
                        boxShadow: highlighted
                          ? `0 18px 34px -22px ${hex(TONO_COLORS.accent, 0.82)}`
                          : `0 10px 24px -22px rgba(16,24,48,${dark ? 0.9 : 0.28})`,
                        transition: `background 0.15s ${TONO_EASE}, border-color 0.15s ${TONO_EASE}, transform 0.15s ${TONO_EASE}`,
                      }}
                    >
                      {highlighted && (
                        <span
                          aria-hidden
                          className="tono-server-card__line"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 18,
                            right: 18,
                            height: 2,
                            borderRadius: 999,
                            background: `linear-gradient(90deg, ${TONO_COLORS.accent}, ${TONO_COLORS.accentSoft}, ${TONO_COLORS.accentWarm})`,
                          }}
                        />
                      )}
                      <span
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 7,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            minWidth: 0,
                          }}
                        >
                          <TonoNodeBadge
                            size={44}
                            city={nodeCityParts(server.name).city}
                          />
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: 14,
                              fontWeight: 650,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {cityTitle}
                          </span>
                          {nodeCityParts(server.name).codename && (
                            <span
                              style={{
                                flexShrink: 0,
                                padding: '2px 6px',
                                borderRadius: 999,
                                color: text.secondary,
                                background: dark
                                  ? 'rgba(255,255,255,0.08)'
                                  : 'rgba(20,22,30,0.05)',
                                fontSize: 9,
                                fontWeight: 650,
                              }}
                            >
                              {nodeCityParts(server.name).codename}
                            </span>
                          )}
                          {server.selected && (
                            <span
                              style={{
                                flexShrink: 0,
                                padding: '3px 6px',
                                borderRadius: 999,
                                color: TONO_COLORS.connected,
                                background: hex(TONO_COLORS.connected, 0.13),
                                fontSize: 9,
                                fontWeight: 750,
                                letterSpacing: 0.6,
                              }}
                            >
                              {t('tono.servers.selected')}
                            </span>
                          )}
                          {isSwitchingCard ? (
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexShrink: 0,
                                padding: '6px 8px',
                                borderRadius: 999,
                                color: TONO_COLORS.accent,
                                background: hex(TONO_COLORS.accent, 0.11),
                                fontSize: 11,
                                fontWeight: 650,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                aria-hidden
                                className="tono-spin"
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: '50%',
                                  border: `1.5px solid ${hex(TONO_COLORS.accent, 0.35)}`,
                                  borderTopColor: TONO_COLORS.accent,
                                  flexShrink: 0,
                                }}
                              />
                              {t('tono.dashboard.status.connecting')}
                            </span>
                          ) : (
                            <span
                              key={latencyText}
                              // Pop only when a result from this session
                              // lands; cached values must not all pop on
                              // first paint.
                              className={
                                endpointLatency !== undefined ||
                                endpointFailure !== undefined ||
                                currentExitTest?.name === server.name
                                  ? 'tono-value-pop'
                                  : undefined
                              }
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexShrink: 0,
                                padding: '6px 8px',
                                borderRadius: 999,
                                color: latencyTone,
                                background: latencyHasTone
                                  ? hex(latencyTone, 0.11)
                                  : dark
                                    ? 'rgba(255,255,255,0.06)'
                                    : 'rgba(56,72,108,0.06)',
                                fontSize: 11,
                                fontWeight: 650,
                                fontFamily: TONO_MONO_STACK,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: latencyTone,
                                  boxShadow: latencyHasTone
                                    ? `0 0 0 3px ${hex(latencyTone, 0.1)}`
                                    : 'none',
                                }}
                              />
                              {latencyText}
                            </span>
                          )}
                        </span>
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                            paddingLeft: 56,
                            color: text.tertiary,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              flexShrink: 0,
                              letterSpacing: 0.4,
                            }}
                          >
                            <TonoIcon name="globe" size={10} />
                            {nodeCode(server.name)}
                          </span>
                          <span
                            style={{
                              padding: '3px 6px',
                              borderRadius: 999,
                              color: text.secondary,
                              background: dark
                                ? 'rgba(255,255,255,0.08)'
                                : 'rgba(235,240,250,0.86)',
                              letterSpacing: 0.2,
                            }}
                          >
                            {t(nodeProtocolKey(server.name))}
                          </span>
                        </span>
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          paddingTop: 10,
                          borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(56,72,108,0.08)'}`,
                          color: server.selected
                            ? TONO_COLORS.connected
                            : text.tertiary,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: server.selected
                                ? TONO_COLORS.connected
                                : available
                                  ? TONO_COLORS.accent
                                  : text.tertiary,
                              opacity: available ? 1 : 0.55,
                            }}
                          />
                          {cardStatus}
                        </span>
                        {server.selected ? (
                          <span
                            aria-hidden
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              color: '#FFFFFF',
                              background: TONO_COLORS.connected,
                            }}
                          >
                            <TonoIcon
                              name="check"
                              size={12}
                              strokeWidth={2.2}
                            />
                          </span>
                        ) : (
                          <span aria-hidden style={{ color: text.tertiary }}>
                            <TonoIcon name="chevronRight" size={14} />
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default ServersPage
