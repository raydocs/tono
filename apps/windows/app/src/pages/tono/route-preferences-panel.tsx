import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'

import type { TonoRoutePreferences, TonoServer } from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { TONO_COLORS, tonoText } from '@/tono-ui/theme'

import {
  catalogBaseName,
  hy2UdpIsVendorBlocked,
  nodeCityLabel,
  nodeCode,
} from './node-meta'
import { recentRoutes, type RouteRecommendation } from './route-preferences'

/** Pure presentation also used by the desktop preview. No selection or history writes on render. */
export const RoutePreferencesPanel = ({
  dark,
  preferences,
  servers,
  recommendation,
  idle,
  busy,
  now,
  onChangeRegion,
  onRecommend,
  onSelect,
  onRetry,
  error,
}: {
  dark: boolean
  preferences: TonoRoutePreferences | undefined
  servers: readonly TonoServer[]
  recommendation: RouteRecommendation | null
  idle: boolean
  busy: boolean
  now: number
  onChangeRegion: (region: string | null) => void
  onRecommend: () => void
  onSelect: (name: string) => void
  onRetry: () => void
  error: boolean
}) => {
  const { t } = useTranslation()
  const text = tonoText(dark)
  const available = servers.filter(
    (server) => server.available && !hy2UdpIsVendorBlocked(server.name),
  )
  const regions = [
    ...new Set(available.map((server) => nodeCode(server.name))),
  ].sort()
  if (preferences?.fixedRegion && !regions.includes(preferences.fixedRegion))
    regions.push(preferences.fixedRegion)
  const favorites =
    preferences?.favorites.flatMap((base) => {
      const server =
        available.find((server) => server.name === base) ??
        available.find((server) => catalogBaseName(server.name) === base)
      return server ? [server] : []
    }) ?? []
  const recent = preferences ? recentRoutes(preferences, servers, now) : []
  const buttonStyle = {
    padding: '7px 10px',
    color: text.primary,
    background: 'var(--tono-surface-raised)',
    fontSize: 12,
  }
  const regionLabel = (code: string) => {
    const key = `tono.nodes.regions.${code.toLowerCase()}`
    const label = t(key)
    return label === key ? code : label
  }
  return (
    <GlassCard style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: 14, color: text.primary }}>
          {t('tono.routes.title')}
        </strong>
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 12,
            color: text.secondary,
          }}
        >
          {t('tono.routes.fixedRegion')}
          <select
            aria-label={t('tono.routes.fixedRegion')}
            className="tono-input"
            style={{ ...buttonStyle, width: 'auto' }}
            value={preferences?.fixedRegion ?? ''}
            disabled={!preferences || busy}
            onChange={(event) => onChangeRegion(event.target.value || null)}
          >
            <option value="">{t('tono.routes.anyRegion')}</option>
            {regions.map((code) => (
              <option key={code} value={code}>
                {regionLabel(code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ fontSize: 11, lineHeight: 1.5, color: text.secondary }}>
        {t('tono.routes.preferenceHint')}
      </p>
      {error && (
        <p
          role="alert"
          style={{ color: 'var(--tono-text-error)', fontSize: 12 }}
        >
          {t('tono.routes.loadFailed')}{' '}
          <button type="button" className="tono-link" onClick={onRetry}>
            {t('shared.actions.retry')}
          </button>
        </p>
      )}
      {!preferences && !error && (
        <p role="status" style={{ color: text.secondary, fontSize: 12 }}>
          {t('tono.routes.loading')}
        </p>
      )}
      {preferences && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
          <div style={{ flex: 1, minWidth: 210 }}>
            <h3
              style={{ margin: '0 0 8px', fontSize: 12, color: text.secondary }}
            >
              {t('tono.routes.favorites')}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {favorites.map((server) => (
                <button
                  key={server.name}
                  type="button"
                  className="tono-button"
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => onSelect(server.name)}
                >
                  {nodeCityLabel(server.name, t)}
                </button>
              ))}
              {!favorites.length && (
                <span style={{ fontSize: 12, color: text.tertiary }}>
                  {t('tono.routes.noFavorites')}
                </span>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 210 }}>
            <h3
              style={{ margin: '0 0 8px', fontSize: 12, color: text.secondary }}
            >
              {t('tono.routes.recent')}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recent.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className="tono-button"
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => onSelect(entry.name)}
                  title={t('tono.routes.verifiedAt', {
                    time: dayjs(entry.verifiedAtMs).format('HH:mm'),
                    revision: entry.revision,
                  })}
                >
                  {nodeCityLabel(entry.name, t)} ·{' '}
                  {dayjs(entry.verifiedAtMs).format('HH:mm')}
                </button>
              ))}
              {!recent.length && (
                <span style={{ fontSize: 12, color: text.tertiary }}>
                  {t('tono.routes.noRecent')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {preferences && (
        <div
          style={{
            borderTop: '1px solid var(--tono-surface-card-border)',
            marginTop: 14,
            paddingTop: 12,
            color: text.secondary,
            fontSize: 12,
          }}
        >
          {idle && recommendation ? (
            <>
              <strong style={{ color: text.primary }}>
                {t('tono.routes.recommended', {
                  name: nodeCityLabel(recommendation.name, t),
                })}
              </strong>
              <p style={{ margin: '6px 0', lineHeight: 1.5 }}>
                {t(`tono.routes.reason.${recommendation.reason}`, {
                  time: dayjs(recommendation.atMs).format('HH:mm'),
                })}
              </p>
              <button
                type="button"
                className="tono-button"
                style={{
                  ...buttonStyle,
                  color: '#fff',
                  background: TONO_COLORS.accent,
                }}
                disabled={busy}
                onClick={onRecommend}
              >
                {t('tono.routes.useRecommendation')}
              </button>
              <span style={{ marginLeft: 10, fontSize: 11 }}>
                {t('tono.routes.selectOnly')}
              </span>
            </>
          ) : (
            <span>
              {t(
                idle
                  ? 'tono.routes.noRecommendation'
                  : 'tono.routes.keepsConnection',
              )}
            </span>
          )}
        </div>
      )}
    </GlassCard>
  )
}
