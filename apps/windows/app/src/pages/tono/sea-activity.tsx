import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { VirtualList } from '@/components/base/virtual-list'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  SeaButton,
  SeaEmpty,
  SeaSkeleton,
  SeaTabs,
} from '@/tono-ui/SeaControls'

import type { ActivityAppRow, ActivityRow } from './activity-model'
import './sea-activity.css'

export type SeaActivityFilter =
  | 'all'
  | 'direct'
  | 'home'
  | 'proxied'
  | 'rejected'
const ROUTES = ['direct', 'home', 'proxied', 'rejected'] as const
const FILTERS = ['all', ...ROUTES] as const

export const SeaActivity = ({
  apps,
  rows,
  connected,
  empty,
  reading,
  query,
  onQuery,
  filter,
  onFilter,
  processLabel,
  closingId,
  closingAll,
  onClose,
  onCloseAll,
  onExplainApp,
  onExplainConnection,
  explanation,
  capped,
}: {
  apps: ActivityAppRow[]
  rows: ActivityRow[]
  connected: boolean
  empty: string
  reading: boolean
  query: string
  onQuery: (value: string) => void
  filter: SeaActivityFilter
  onFilter: (value: SeaActivityFilter) => void
  processLabel: (process: string) => string
  closingId: string | null
  closingAll: boolean
  onClose: (id: string) => void
  onCloseAll: () => void
  onExplainApp: (process: string) => void
  onExplainConnection: (row: ActivityRow) => void
  explanation: React.ReactNode
  capped: boolean
}) => {
  const { t } = useTranslation()
  const [allFor, setAllFor] = useState<ReadonlySet<string>>(new Set())
  const routeLabel = (route: (typeof FILTERS)[number]) =>
    route === 'proxied'
      ? t('tono.seaActivity.exit')
      : t(`tono.activity.filters.${route}`)
  const connection = (row: ActivityRow) => (
    <div className="sea-activity-connection" key={row.id}>
      <button
        type="button"
        className="sea-activity-target"
        title={row.target}
        aria-label={t('tono.routeExplanation.openConnection', {
          target: row.target,
        })}
        onClick={() => onExplainConnection(row)}
      >
        {row.target}
      </button>
      <span>{row.protocol}</span>
      <span className="sea-activity-route" data-route={row.route}>
        {row.route === 'proxied'
          ? t('tono.seaActivity.exit')
          : t(`tono.activity.routes.${row.route}`)}
      </span>
      <span title={row.rule}>{row.rule}</span>
      <button
        type="button"
        className="sea-button"
        data-variant="text"
        aria-label={t('tono.activity.closeConnection', { target: row.target })}
        disabled={closingId === row.id || closingAll}
        onClick={() => onClose(row.id)}
      >
        ×
      </button>
    </div>
  )
  return (
    <div className="sea-activity">
      <PageHeader
        title={t('tono.activity.title')}
        subtitle={t('tono.activity.subtitle')}
      />
      {explanation}
      <div className="sea-activity-toolbar">
        <input
          type="search"
          className="sea-field"
          aria-label={t('tono.activity.search')}
          placeholder={t('tono.activity.search')}
          value={query}
          disabled={!connected}
          onChange={(event) => onQuery(event.target.value)}
        />
        <span className="sea-activity-legend">
          {ROUTES.map((route) => (
            <span key={route}>
              <i data-route={route} />
              {routeLabel(route)}
            </span>
          ))}
        </span>
      </div>
      <SeaTabs
        label={t('tono.activity.routeFilter')}
        value={filter}
        options={FILTERS.map((value) => ({
          value,
          label: routeLabel(value),
        }))}
        onChange={(value) => {
          if (connected) onFilter(value as SeaActivityFilter)
        }}
      />
      {/* Without a reading there is no count to state, not a zero. */}
      {connected && (
        <p className="sea-activity-summary">
          {t('tono.seaActivity.summary', {
            apps: apps.length,
            connections: rows.length,
          })}
        </p>
      )}
      {!connected || !apps.length ? (
        reading ? (
          <div>
            {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
              <SeaSkeleton key={key} label={empty} />
            ))}
          </div>
        ) : (
          <SeaEmpty>{empty}</SeaEmpty>
        )
      ) : (
        <VirtualList
          count={apps.length}
          estimateSize={50}
          overscan={8}
          getItemKey={(index) => apps[index]?.process ?? index}
          style={{ flex: 1, minHeight: 120 }}
          renderItem={(index) => {
            const app = apps[index]
            if (!app) return null
            const appRows = rows.filter((row) => row.process === app.process)
            const entries = allFor.has(app.process)
              ? appRows
              : appRows.slice(0, 20)
            return (
              <details
                className="sea-activity-app"
                onToggle={(event) => {
                  // A collapsed app goes back to its first twenty rows.
                  if (event.currentTarget.open) return
                  setAllFor((shown) => {
                    if (!shown.has(app.process)) return shown
                    const next = new Set(shown)
                    next.delete(app.process)
                    return next
                  })
                }}
              >
                <summary className="sea-activity-app-row">
                  <span className="sea-activity-app-icon" aria-hidden="true">
                    {processLabel(app.process).slice(0, 1)}
                  </span>
                  <span className="sea-activity-app-name">
                    {processLabel(app.process)}
                  </span>
                  <span>{app.total}</span>
                  <span
                    className="sea-activity-bar"
                    role="img"
                    aria-label={t('tono.activity.splitHint', {
                      direct: app.direct,
                      home: app.home,
                      proxied: app.proxied,
                      rejected: app.rejected,
                    })}
                  >
                    {ROUTES.map((route) => (
                      <i
                        key={route}
                        data-route={route}
                        style={{ flex: Math.max(0, app[route]) }}
                      />
                    ))}
                  </span>
                  <span className="sea-activity-counts">
                    {ROUTES.map((route) => (
                      <span
                        key={route}
                        data-route={route}
                        title={routeLabel(route)}
                      >
                        {app[route]}
                      </span>
                    ))}
                  </span>
                </summary>
                <div className="sea-activity-expanded">
                  {entries.map(connection)}
                  <SeaButton
                    variant="text"
                    aria-label={t('tono.routeExplanation.openApp', {
                      name: processLabel(app.process),
                    })}
                    onClick={() => onExplainApp(app.process)}
                  >
                    {t('tono.routeExplanation.title', {
                      name: processLabel(app.process),
                    })}
                  </SeaButton>
                  {appRows.length > entries.length && (
                    <SeaButton
                      variant="text"
                      onClick={() =>
                        setAllFor((shown) => new Set(shown).add(app.process))
                      }
                    >
                      {t('tono.seaActivity.showAll', { count: appRows.length })}
                    </SeaButton>
                  )}
                </div>
              </details>
            )
          }}
        />
      )}
      {/* An empty list has nothing to close; a dead red action read as broken. */}
      {connected && rows.length > 0 && (
        <footer>
          <SeaButton
            variant="danger"
            disabled={closingAll}
            onClick={onCloseAll}
          >
            {t(
              closingAll
                ? 'tono.activity.closingAll'
                : 'tono.activity.closeAll',
            )}
          </SeaButton>
          <span>
            {t('tono.activity.closeAllHint')}
            {capped && ` · ${t('tono.activity.limitNotice', { count: 2000 })}`}
          </span>
        </footer>
      )}
    </div>
  )
}
