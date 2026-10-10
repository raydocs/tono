import { useTranslation } from 'react-i18next'

import { useThemeMode } from '@/services/states'
import { TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'

import type { ControlPlanePathFailure } from './login-paths'

/**
 * The control-plane paths a failed sign-in tried, each with how it failed and how long it took
 * (A3, the macOS wording of #1464). The copy button below it carries the same list.
 */
export const LoginPathFailures = ({
  paths,
}: {
  paths: ControlPlanePathFailure[]
}) => {
  const { t } = useTranslation()
  const text = tonoText(useThemeMode() !== 'light')
  const title = t('tono.login.paths.title')
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'center',
        width: '100%',
      }}
    >
      <strong style={{ fontSize: 12, color: text.primary }}>{title}</strong>
      <dl
        aria-label={title}
        style={{
          margin: 0,
          fontSize: 12,
          width: '100%',
          maxWidth: 420,
          textAlign: 'left',
        }}
      >
        {/* Each path appears once in the combined message. */}
        {paths.map(({ label, kind, elapsedMs }) => (
          <div
            key={label}
            style={{
              display: 'grid',
              // A fixed last column keeps every row's columns aligned (each row is its own grid).
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 72px',
              gap: 12,
              padding: '4px 0',
            }}
          >
            <dt style={{ color: text.secondary }}>
              {t(`tono.login.paths.${label}`)}
            </dt>
            <dd style={{ margin: 0, color: text.primary }}>
              {t(`tono.login.paths.kind.${kind}`)}
            </dd>
            <dd
              style={{
                margin: 0,
                color: text.tertiary,
                fontFamily: TONO_MONO_STACK,
                textAlign: 'right',
              }}
            >
              {t('tono.login.paths.elapsed', {
                seconds: (elapsedMs / 1000).toFixed(1),
              })}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
