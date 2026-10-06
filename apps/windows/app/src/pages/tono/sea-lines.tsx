import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import type {
  TonoCatalogStatus,
  TonoRoutePreferences,
  TonoServer,
  TonoUiState,
} from '@/services/tono'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  SeaAttentionCard,
  SeaButton,
  SeaEmpty,
  SeaPanel,
  SeaPopover,
  SeaSignalBars,
  SeaSkeleton,
  SeaTabs,
  SeaTag,
} from '@/tono-ui/SeaControls'

import {
  catalogBaseName,
  hy2UdpIsVendorBlocked,
  isHy2CatalogName,
  nodeCityLabel,
  nodeCode,
  nodeDisplayName,
  nodeProtocolKey,
} from './node-meta'
import {
  MAX_FAVORITES,
  recentRoutes,
  type RouteRecommendation,
} from './route-preferences'

import './sea-lines.css'

interface Props {
  servers?: TonoServer[]
  uiState?: TonoUiState
  /** Live Service evidence, not the FSM state: only this may colour a line as good. */
  protectionLive: boolean
  preferences?: TonoRoutePreferences
  recommendation: RouteRecommendation | null
  catalog?: TonoCatalogStatus
  search: string
  onSearch: (value: string) => void
  busy: boolean
  saving: boolean
  testing: boolean
  testLabel: string
  testDisabled: boolean
  onTest: () => void
  onSelect: (name: string, selected: boolean, available: boolean) => void
  onFavorite: (name: string) => void
  onRegion: (region: string | null) => void
  onConnect: () => Promise<boolean>
  pendingName: string | null
  latency: (server: TonoServer) => { label: string; level: 0 | 1 | 2 | 3 }
  error: string | null
  readError: string | null
  preferencesError: boolean
  onPreferencesRetry: () => void
  catalogError: { message: string; detail?: string | null } | null
  feedback: string | null
  refreshing: boolean
  refreshDisabled: boolean
  onRefresh: () => void
  onReadRetry: () => void
  regionLabel: (code: string) => string
  now: number
}

/** A new arrangement of existing actions; all native IO stays in ServersPage. */
export const SeaLines = ({
  preferences,
  servers,
  search,
  recommendation,
  pendingName,
  uiState,
  protectionLive,
  latency,
  busy,
  saving,
  onFavorite,
  onSelect,
  onSearch,
  testDisabled,
  onTest,
  testLabel,
  onRegion,
  now,
  preferencesError,
  onPreferencesRetry,
  error,
  catalogError,
  refreshDisabled,
  onRefresh,
  readError,
  onReadRetry,
  catalog,
  refreshing,
  feedback,
  onConnect,
  regionLabel,
}: Props) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [help, setHelp] = useState<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [connecting, setConnecting] = useState(false)
  const favorite = (name: string) =>
    preferences?.favorites.includes(catalogBaseName(name)) ?? false
  const regions = [
    ...new Set(
      (servers ?? [])
        .filter((server) => !hy2UdpIsVendorBlocked(server.name))
        .map((server) => nodeCode(server.name)),
    ),
  ].sort()
  const query = search.trim().toLowerCase()
  const visible = (servers ?? []).filter((server) => {
    if (hy2UdpIsVendorBlocked(server.name)) return false
    const matches =
      !query ||
      [
        nodeDisplayName(server.name),
        server.name,
        nodeCityLabel(server.name, t),
        t(nodeProtocolKey(server.name)),
      ].some((value) => value.toLowerCase().includes(query))
    return (
      matches &&
      (favoritesOnly
        ? favorite(server.name)
        : !preferences?.fixedRegion ||
          nodeCode(server.name) === preferences.fixedRegion)
    )
  })
  const recommended = servers?.find(
    (server) => server.name === recommendation?.name,
  )
  const pending = servers?.find(
    (server) => server.name === pendingName && server.available,
  )
  const idle = uiState === 'notConnected'
  const row = (server: TonoServer) => {
    const measurement = latency(server)
    const disabled = !server.available || busy
    const title = !server.available
      ? t('tono.nodes.unavailableHint')
      : undefined
    return (
      <div
        key={server.name}
        className="sea-line-row"
        data-selected={server.selected}
        data-unavailable={!server.available}
      >
        <button
          type="button"
          className="sea-line-star"
          aria-pressed={favorite(server.name)}
          aria-label={t(
            favorite(server.name)
              ? 'tono.routes.removeFavorite'
              : 'tono.routes.addFavorite',
            { name: nodeCityLabel(server.name, t) },
          )}
          disabled={
            !preferences ||
            !server.available ||
            saving ||
            (!favorite(server.name) &&
              preferences.favorites.length >= MAX_FAVORITES)
          }
          onClick={() => onFavorite(server.name)}
        >
          {favorite(server.name) ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="sea-line-pick"
          data-line-name={server.name}
          aria-disabled={disabled}
          title={title}
          onClick={() => {
            if (!disabled)
              onSelect(server.name, server.selected, server.available)
          }}
          onKeyDown={(event) => {
            if (
              event.key.toLowerCase() === 'f' &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault()
              if (
                preferences &&
                server.available &&
                !saving &&
                (favorite(server.name) ||
                  preferences.favorites.length < MAX_FAVORITES)
              )
                onFavorite(server.name)
            }
          }}
        >
          <span className="sea-line-name">{nodeDisplayName(server.name)}</span>
          <span className="sea-line-city">{nodeCityLabel(server.name, t)}</span>
          {isHy2CatalogName(server.name) && (
            <SeaTag>{t('tono.nodes.regions.udpBackup')}</SeaTag>
          )}
          <span className="sea-line-latency">
            <SeaSignalBars
              level={measurement.level}
              label={measurement.label}
            />
            {measurement.label}
          </span>
        </button>
      </div>
    )
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Page keyboard shortcuts delegate to real input and row buttons; the container is not a focus stop.
    <div
      className="sea-lines"
      onKeyDown={(event) => {
        if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
          event.preventDefault()
          searchRef.current?.focus()
          return
        }
        if (
          !['ArrowDown', 'ArrowUp'].includes(event.key) ||
          event.target instanceof HTMLInputElement
        )
          return
        const buttons = [
          ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
            '[data-line-name]:not([aria-disabled="true"])',
          ) ?? []),
        ]
        if (!buttons.length) return
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        const next =
          current < 0
            ? 0
            : (current +
                (event.key === 'ArrowDown' ? 1 : -1) +
                buttons.length) %
              buttons.length
        event.preventDefault()
        buttons[next]?.focus()
      }}
    >
      <PageHeader
        // The page is named as the navigation names it.
        title={t('tono.nav.nodes')}
        trailing={
          <div className="sea-lines-actions">
            <label>
              <span className="sea-lines-search-label">
                {t('tono.nodes.search')}
              </span>
              <input
                ref={searchRef}
                type="search"
                className="sea-field"
                aria-label={t('tono.nodes.search')}
                placeholder={t('tono.nodes.search')}
                value={search}
                onChange={(event) => onSearch(event.target.value)}
              />
            </label>
            <SeaButton disabled={testDisabled} onClick={onTest}>
              {testLabel}
            </SeaButton>
          </div>
        }
      />
      <SeaTabs
        label={t('tono.routes.fixedRegion')}
        value={
          favoritesOnly ? 'favorites' : (preferences?.fixedRegion ?? 'all')
        }
        options={[
          { value: 'all', label: t('tono.nodes.regions.all') },
          ...regions.map((region) => ({
            value: region,
            label: regionLabel(region),
          })),
          { value: 'favorites', label: t('tono.routes.favorites') },
        ]}
        onChange={(value) => {
          if (busy || saving) return
          setFavoritesOnly(value === 'favorites')
          if (value !== 'favorites') onRegion(value === 'all' ? null : value)
        }}
      />
      <SeaPanel className="sea-lines-recommended">
        <div>
          <SeaTag>{t('tono.seaLines.recommendation')}</SeaTag>
          <SeaButton
            variant="text"
            aria-label={t('tono.seaLines.explanation')}
            onClick={(event) => setHelp(event.currentTarget)}
          >
            ?
          </SeaButton>
          <h2>
            {recommended
              ? nodeDisplayName(recommended.name)
              : t('tono.routes.noRecommendation')}
          </h2>
          {recommended && (
            <p>
              {nodeCityLabel(recommended.name, t)} ·{' '}
              {latency(recommended).label}
            </p>
          )}
          <p>
            {/* The record keeps one entry per line, so it says whether, never how often. */}
            {recommended && preferences
              ? recentRoutes(preferences, servers ?? [], now).some(
                  (entry) =>
                    entry.name === recommended.name &&
                    entry.revision === preferences?.catalogRevision,
                )
                ? t('tono.seaLines.evidence')
                : t('tono.seaLines.noEvidence')
              : t('tono.routes.noRecent')}
          </p>
        </div>
        {recommended &&
          (recommended.selected && uiState === 'connected' ? (
            <SeaTag kind={protectionLive ? 'good' : 'quiet'}>
              {t('tono.seaLines.inUse')}
            </SeaTag>
          ) : (
            // Select only, as the explanation says: a running tunnel is switched from its row.
            idle && (
              <SeaButton
                disabled={busy || !recommended.available}
                onClick={() =>
                  onSelect(
                    recommended.name,
                    recommended.selected,
                    recommended.available,
                  )
                }
              >
                {t('tono.routes.useRecommendation')}
              </SeaButton>
            )
          ))}
      </SeaPanel>
      <SeaPopover anchor={help} onClose={() => setHelp(null)}>
        <p>{t('tono.routes.preferenceHint')}</p>
        <p>
          {idle
            ? t('tono.routes.selectOnly')
            : t('tono.routes.keepsConnection')}
        </p>
        {recommendation && (
          <p>
            {t(`tono.routes.reason.${recommendation.reason}`, {
              time: dayjs(recommendation.atMs).format('HH:mm'),
            })}
          </p>
        )}
        {preferences &&
          recentRoutes(preferences, servers ?? [], now).map((entry) => (
            <SeaButton
              key={entry.name}
              variant="text"
              disabled={busy}
              onClick={() => {
                const server = servers?.find(
                  (server) => server.name === entry.name,
                )
                if (server)
                  onSelect(server.name, server.selected, server.available)
                setHelp(null)
              }}
            >
              {nodeCityLabel(entry.name, t)} ·{' '}
              {dayjs(entry.verifiedAtMs).format('HH:mm')}
            </SeaButton>
          ))}
      </SeaPopover>
      {preferencesError && (
        <SeaAttentionCard>
          {t('tono.routes.loadFailed')}{' '}
          <SeaButton variant="text" onClick={onPreferencesRetry}>
            {t('shared.actions.retry')}
          </SeaButton>
        </SeaAttentionCard>
      )}
      {error && <SeaAttentionCard>{error}</SeaAttentionCard>}
      {catalogError && (
        <SeaAttentionCard>
          {t('tono.nodes.catalogError', { error: catalogError.message })}
          {catalogError.detail && (
            <details>
              <summary>{t('tono.progress.technicalDetails')}</summary>
              {catalogError.detail}
            </details>
          )}
          <SeaButton
            variant="text"
            disabled={refreshDisabled}
            onClick={onRefresh}
          >
            {t('shared.actions.retry')}
          </SeaButton>
        </SeaAttentionCard>
      )}
      {readError ? (
        <SeaEmpty
          action={
            <SeaButton onClick={onReadRetry}>
              {t('shared.actions.retry')}
            </SeaButton>
          }
        >
          {readError}
        </SeaEmpty>
      ) : !servers ? (
        <div aria-busy="true">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
            <SeaSkeleton key={key} label={t('shared.statuses.loading')} />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <SeaEmpty>{t('tono.nodes.empty')}</SeaEmpty>
      ) : !visible.length ? (
        <SeaEmpty
          action={
            <SeaButton
              variant="text"
              onClick={() => {
                onSearch('')
                setFavoritesOnly(false)
                onRegion(null)
              }}
            >
              {t('tono.nodes.regions.all')}
            </SeaButton>
          }
        >
          {t('tono.nodes.noMatches')}
        </SeaEmpty>
      ) : (
        <div ref={listRef}>
          {!favoritesOnly &&
            visible.some((server) => favorite(server.name)) && (
              <section>
                <h3>{t('tono.routes.favorites')}</h3>
                {visible.filter((server) => favorite(server.name)).map(row)}
              </section>
            )}
          <section>
            <h3>
              {favoritesOnly
                ? t('tono.routes.favorites')
                : t('tono.seaLines.all', { count: visible.length })}
            </h3>
            {(favoritesOnly
              ? visible
              : visible.filter((server) => !favorite(server.name))
            ).map(row)}
          </section>
        </div>
      )}
      <footer className="sea-lines-sync">
        {t('tono.nodes.catalogNodes', {
          count: catalog?.nodeCount ?? servers?.length ?? 0,
        })}{' '}
        ·{' '}
        {catalog?.lastSyncedAtMs
          ? t('tono.nodes.lastSynced', {
              time: dayjs(catalog.lastSyncedAtMs).format('YYYY-MM-DD HH:mm'),
            })
          : t('tono.nodes.waitingForSync')}{' '}
        <SeaButton
          variant="text"
          disabled={refreshDisabled}
          onClick={onRefresh}
        >
          {refreshing ? t('tono.nodes.refreshing') : t('tono.nodes.refresh')}
        </SeaButton>
        {feedback && <span role="status">{feedback}</span>}
        <span className="sea-lines-revision">
          v{catalog?.revision ?? '—'} · {t('tono.nodes.verifiedSyncHint')}
        </span>
      </footer>
      {idle && pending && (
        <div role="status" className="sea-lines-selection">
          <span>
            {t('tono.seaLines.selected', {
              name: nodeCityLabel(pending.name, t),
              latency: latency(pending).label,
            })}
          </span>
          <SeaButton
            variant="primary"
            disabled={busy || connecting}
            onClick={async () => {
              setConnecting(true)
              try {
                if (await onConnect()) navigate('/')
              } finally {
                setConnecting(false)
              }
            }}
          >
            {t('tono.tray.connect')}
          </SeaButton>
        </div>
      )}
    </div>
  )
}
