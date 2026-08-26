import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { tonoServersQueryKey, useTonoStatus } from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoCancelServerTests,
  tonoCatalogStatus,
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
  nodeCityParts,
  nodeCityTitleKey,
  nodeCode,
  nodeDisplayName,
  nodeProtocol,
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

const ServersPage = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()
  const showToast = useTonoToast()
  const [selectError, setSelectError] = useState<string | null>(null)
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

  const { data: servers, refetch: mutateServers } = useQuery({
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
      if (selected) return
      if (!available) {
        setSelectError(t('tono.nodes.unavailableHint'))
        return
      }
      setSelectError(null)
      try {
        await tonoSelectServer(name)
        await Promise.all([mutateServers(), mutateTonoStatus()])
        showToast(t('tono.nodes.switchedTo', { name: nodeDisplayName(name) }))
      } catch (error) {
        setSelectError(error instanceof Error ? error.message : String(error))
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
      setSelectError(error instanceof Error ? error.message : String(error))
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
        setSelectError(error instanceof Error ? error.message : String(error))
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
      setSelectError(error instanceof Error ? error.message : String(error))
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
        (parts.codename?.toLowerCase().includes(query) ?? false)
      const matchesRegion =
        !regionFilter || nodeCode(server.name) === regionFilter
      return matchesQuery && matchesRegion
    })
  }, [query, regionFilter, servers])
  const regionOptions = useMemo(() => {
    return Array.from(
      new Set((servers ?? []).map((server) => nodeCode(server.name))),
    ).sort()
  }, [servers])
  const serverGroups = useMemo(() => {
    const usable = visibleServers.filter((server) => server.available !== false)
    const codes = Array.from(
      new Set(usable.map((server) => nodeCode(server.name))),
    ).sort()
    return [
      ...codes.map((code) => ({
        key: code,
        label: code,
        servers: usable.filter((server) => nodeCode(server.name) === code),
      })),
      {
        key: 'unavailable',
        label: t('tono.nodes.regions.unavailable'),
        servers: visibleServers.filter((server) => server.available === false),
      },
    ].filter((group) => group.servers.length > 0)
  }, [t, visibleServers])
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
                background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.62)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
              }}
            >
              <TonoTestIcon />
              {testingAll ? t('tono.nodes.cancelTest') : t('tono.nodes.testAll')}
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
                background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.62)',
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
              background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)',
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
                ? TONO_COLORS.error
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
            background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.42)',
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
        <div
          className="tono-chip-row"
          role="group"
          aria-label={t('tono.nodes.regions.all')}
          style={{
            background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.32)',
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
              background: regionFilter === null ? TONO_COLORS.accent : 'transparent',
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
                background: regionFilter === code ? TONO_COLORS.accent : 'transparent',
              }}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      {selectError && (
        <p
          role="alert"
          style={{ margin: '0 0 8px', fontSize: 12, color: TONO_COLORS.error }}
        >
          {selectError}
        </p>
      )}

      {(servers ?? []).length === 0 ? (
        <p style={{ fontSize: 13, color: text.secondary }}>
          {t('tono.nodes.empty')}
        </p>
      ) : visibleServers.length === 0 ? (
        <p style={{ fontSize: 13, color: text.secondary }}>
          {t('tono.nodes.noMatches')}
        </p>
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
                  return (
                    <button
                      key={server.name}
                      type="button"
                      className="tono-server-card"
                      disabled={!available}
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
                        cursor: !available
                          ? 'not-allowed'
                          : server.selected
                            ? 'default'
                            : 'pointer',
                        opacity: available ? 1 : 0.55,
                        color: text.primary,
                        background: server.selected
                          ? hex(TONO_COLORS.accent, dark ? 0.13 : 0.08)
                          : dark
                            ? 'rgba(16,21,33,0.72)'
                            : 'rgba(255,255,255,0.76)',
                        border: server.selected
                          ? `1px solid ${hex(TONO_COLORS.accent, 0.55)}`
                          : `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(56,72,108,0.09)'}`,
                        boxShadow: server.selected
                          ? `0 18px 34px -22px ${hex(TONO_COLORS.accent, 0.82)}`
                          : `0 10px 24px -22px rgba(16,24,48,${dark ? 0.9 : 0.28})`,
                        transition: `background 0.15s ${TONO_EASE}, border-color 0.15s ${TONO_EASE}, transform 0.15s ${TONO_EASE}`,
                      }}
                    >
                      {server.selected && (
                        <span
                          aria-hidden
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
                            {nodeCityTitleKey(server.name)
                              ? t(nodeCityTitleKey(server.name)!)
                              : nodeDisplayName(server.name)}
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
                          <span
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
                            {!available
                              ? t('tono.nodes.unavailable')
                              : endpointFailure === 'timeout'
                                ? t('tono.nodes.timeout')
                                : endpointFailure
                                  ? t('tono.nodes.testFailed')
                                  : latencyLabel}
                          </span>
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
                            {nodeProtocol(server.name)}
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: TONO_COLORS.connected,
                                flexShrink: 0,
                              }}
                            />
                            {t('tono.dashboard.info.protection')}
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
                            <TonoIcon name="check" size={12} strokeWidth={2.2} />
                          </span>
                        ) : (
                          <span aria-hidden style={{ color: text.tertiary }}>
                            <TonoIcon name="chevronRight" size={14} />
                          </span>
                        )}
                      </span>
                      {server.selected && (
                        <span
                          aria-hidden
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 18,
                            right: 18,
                            height: 2,
                            borderRadius: 999,
                            background: `linear-gradient(90deg, ${TONO_COLORS.accent}, ${TONO_COLORS.accentWarm})`,
                          }}
                        />
                      )}
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
