import { useLockFn } from 'ahooks'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { tonoServersQueryKey } from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import { connectIfIdleAfterSelection } from '@/services/server-selection'
import {
  formatTonoActionError,
  idleSelectShouldConnect,
  tonoRoutePreferences,
  tonoSelectServer,
  tonoServers,
  type TonoStatus,
} from '@/services/tono'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'
import { useTonoToast } from '@/tono-ui/tono-toast-context'
import { TonoIcon } from '@/tono-ui/TonoIcon'

import { useHomeDialog } from './home-focus'
import { homeLineParts, homeLineReading } from './home-line-meta'
import { latencyLabelKey, latencyLabelVars } from './node-latency'
import { catalogBaseName, nodeCityLabel } from './node-meta'
import {
  preferencesMatch,
  recentRoutes,
  recommendRoute,
  unstableRoute,
} from './route-preferences'

export const HomeLines = ({
  open,
  anchor,
  root,
  close,
  status,
  refreshStatus,
}: {
  open: boolean
  anchor: RefObject<HTMLButtonElement | null>
  root: RefObject<HTMLDivElement | null>
  close: () => void
  status: TonoStatus | undefined
  refreshStatus: () => Promise<unknown>
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const showToast = useTonoToast()
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({
    left: 56,
    top: 300,
    maxHeight: 240,
  })
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: servers, refetch: refreshServers } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
    enabled: open,
  })
  const scope = status?.routePreferenceScope
  const { data: saved } = useQuery({
    queryKey: ['tono', 'route-preferences', scope, status?.catalogRevision],
    queryFn: tonoRoutePreferences,
    enabled: open && !!scope,
  })
  const preferences = preferencesMatch(saved, scope, status?.catalogRevision)
    ? saved
    : undefined
  const [now] = useState(Date.now)
  const recommended = recommendRoute(
    servers ?? [],
    preferences,
    scope,
    status?.catalogRevision,
    { scope: null, revision: null, atMs: 0, latencies: {}, failures: {} },
    now,
    unstableRoute(status, now),
  )
  const candidates: {
    name: string
    group: 'recommended' | 'favorites' | 'recent'
  }[] = []
  if (recommended)
    candidates.push({ name: recommended.name, group: 'recommended' })
  for (const server of servers ?? []) {
    if (preferences?.favorites.includes(catalogBaseName(server.name)))
      candidates.push({ name: server.name, group: 'favorites' })
  }
  if (preferences)
    for (const recent of recentRoutes(preferences, servers ?? [], now))
      candidates.push({ name: recent.name, group: 'recent' })
  const rows = candidates
    .filter(
      (row, index) =>
        candidates.findIndex((other) => other.name === row.name) === index,
    )
    .slice(0, 5)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const bounds = root.current?.getBoundingClientRect()
      const chip = anchor.current?.getBoundingClientRect()
      if (!bounds || !chip) return
      // Flip above the chip in short windows; otherwise grow downward from it.
      const below = bounds.bottom - chip.bottom - 16
      const above = chip.top - bounds.top - 16
      const down = below >= Math.min(260, above)
      const maxHeight = Math.max(72, Math.min(320, down ? below : above))
      const height = Math.min(panelRef.current?.scrollHeight ?? 260, maxHeight)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- measure anchor collision before paint; ResizeObserver handles subsequent layout changes
      setPosition({
        left: Math.max(
          12,
          Math.min(chip.left - bounds.left, bounds.width - 332),
        ),
        top: down
          ? chip.bottom - bounds.top + 8
          : chip.top - bounds.top - height - 8,
        maxHeight,
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (root.current) observer.observe(root.current)
    if (anchor.current) observer.observe(anchor.current)
    if (panelRef.current) observer.observe(panelRef.current)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, root])
  useHomeDialog(open, panelRef, anchor, close)

  const select = useLockFn(async (name: string) => {
    const server = servers?.find((row) => row.name === name)
    if (!server?.available) {
      setError(t('tono.nodes.unavailableHint'))
      return
    }
    // Identical admission and dispatch to ServersPage.handleSelect. Do not invent
    // an idle check or optimistic "connected" state outside the existing service.
    if (server.selected && !idleSelectShouldConnect(status?.uiState)) return
    setSelecting(name)
    setError(null)
    try {
      if (!server.selected) await tonoSelectServer(name)
      await connectIfIdleAfterSelection()
      if (server.selected) await refreshStatus()
      else {
        await Promise.all([refreshServers(), refreshStatus()])
        showToast(
          t('tono.nodes.switchRequested', { name: nodeCityLabel(name, t) }),
        )
      }
      close()
    } catch (cause) {
      setError(formatTonoActionError(cause, t))
    } finally {
      setSelecting(null)
    }
  })
  if (!open) return null
  return (
    <>
      <div
        className="tono-home__dismiss"
        onPointerDown={close}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="tono-home__lines tono-home__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('tono.home.popover.title')}
        tabIndex={-1}
        style={{
          position: 'absolute',
          width: 320,
          maxWidth: 'calc(100% - 24px)',
          left: position.left,
          top: position.top,
          maxHeight: position.maxHeight,
          overflowY: 'auto',
        }}
      >
        {rows.map((row, index) => {
          const server = servers?.find((server) => server.name === row.name)
          const reading = homeLineReading(row.name, status)
          const delay = reading?.ms ?? null
          const parts = homeLineParts(row.name, t)
          return (
            <div key={row.name}>
              {rows[index - 1]?.group !== row.group && (
                <div className="tono-home__line-group">
                  {t(`tono.home.popover.${row.group}`)}
                </div>
              )}
              <button
                type="button"
                className="tono-home__line-row"
                disabled={selecting !== null || !server?.available}
                onClick={() => void select(row.name)}
                aria-pressed={server?.selected === true}
                title={`${parts.name} ${parts.city}`}
                aria-label={`${parts.name} ${parts.city} · ${reading === null ? t('tono.nodes.untested') : t(latencyLabelKey(reading.kind, reading.ms), latencyLabelVars(reading.ms))}`}
              >
                <span
                  className="tono-home__dot"
                  data-lit={
                    server?.selected &&
                    status?.uiState === 'connected' &&
                    hasLiveProtection(status)
                  }
                />
                <span className="tono-home__row-name">
                  {parts.name}{' '}
                  {parts.city && (
                    <span className="tono-home__row-city">{parts.city}</span>
                  )}
                </span>
                <small>
                  {selecting === row.name
                    ? '…'
                    : delay === null
                      ? '—'
                      : `${delay} ms`}
                </small>
                {server?.selected && (
                  <span
                    aria-hidden="true"
                    data-testid="tono-home-selected-check"
                  >
                    <TonoIcon name="check" size={12} />
                  </span>
                )}
              </button>
            </div>
          )
        })}
        {!rows.length && (
          <p className="tono-home__line-empty">
            {t('tono.home.popover.empty')}
          </p>
        )}
        {error && (
          <p role="alert" className="tono-home__line-error">
            {error}
          </p>
        )}
        <button
          type="button"
          className="tono-home__line-row tono-home__all-lines"
          onClick={() => {
            close()
            navigate('/servers')
          }}
        >
          {t('tono.home.popover.all')}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </>
  )
}
