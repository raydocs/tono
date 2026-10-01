import { useTranslation } from 'react-i18next'

import { GlassCard } from '@/tono-ui/GlassCard'
import { TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'

import type { ActivityRow } from './activity-model'

export const ActivityRouteExplanation = ({
  rows,
  title,
  dark,
  onClose,
}: {
  rows: readonly ActivityRow[]
  title: string
  dark: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const text = tonoText(dark)
  return (
    <GlassCard style={{ flexShrink: 0, maxHeight: 290, overflowY: 'auto' }}>
      <section aria-label={t('tono.routeExplanation.title', { name: title })}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <strong style={{ fontSize: 14, color: text.primary }}>
            {t('tono.routeExplanation.title', { name: title })}
          </strong>
          <button
            type="button"
            className="tono-link"
            onClick={onClose}
            style={{ color: text.secondary }}
          >
            {t('tono.routeExplanation.close')}
          </button>
        </div>
        <p style={{ color: text.secondary, fontSize: 12, lineHeight: 1.5 }}>
          {t('tono.routeExplanation.observationHint')}
        </p>
        {!rows.length && (
          <p style={{ color: text.secondary }}>
            {t('tono.routeExplanation.gone')}
          </p>
        )}
        {rows.slice(0, 20).map((row) => (
          <div
            key={row.id}
            style={{
              padding: '10px 0',
              borderTop: '1px solid var(--tono-surface-card-border)',
              color: text.primary,
              fontSize: 12,
            }}
          >
            <strong style={{ overflowWrap: 'anywhere' }}>
              {row.target} · {row.protocol}
            </strong>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '110px minmax(0, 1fr)',
                gap: '6px 12px',
                marginBottom: 0,
              }}
            >
              <dt style={{ color: text.secondary }}>
                {t('tono.routeExplanation.observedRoute')}
              </dt>
              <dd style={{ margin: 0 }}>
                {t(
                  row.observedRoute === 'unknown'
                    ? 'tono.routeExplanation.unknown'
                    : `tono.activity.routes.${row.observedRoute}`,
                )}
              </dd>
              <dt style={{ color: text.secondary }}>
                {t('tono.routeExplanation.matchedRule')}
              </dt>
              <dd
                style={{
                  margin: 0,
                  overflowWrap: 'anywhere',
                  fontFamily: TONO_MONO_STACK,
                }}
              >
                {row.rule === '—'
                  ? t('tono.routeExplanation.notReported')
                  : row.rule}
              </dd>
              <dt style={{ color: text.secondary }}>
                {t('tono.routeExplanation.chain')}
              </dt>
              <dd
                style={{
                  margin: 0,
                  overflowWrap: 'anywhere',
                  fontFamily: TONO_MONO_STACK,
                }}
              >
                {row.chain.length
                  ? row.chain.map((hop) => hop || '—').join(' ← ')
                  : t('tono.routeExplanation.notReported')}
                {row.chainTruncated ? ' …' : ''}
              </dd>
            </dl>
            <p style={{ marginBottom: 0, color: text.tertiary, fontSize: 11 }}>
              {t(
                row.observedRoute === 'unknown'
                  ? 'tono.routeExplanation.insufficient'
                  : 'tono.routeExplanation.chainHint',
              )}
            </p>
          </div>
        ))}
        {rows.length > 20 && (
          <p style={{ color: text.secondary, fontSize: 11 }}>
            {t('tono.routeExplanation.limit')}
          </p>
        )}
      </section>
    </GlassCard>
  )
}
