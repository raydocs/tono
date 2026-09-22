import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTonoStatus } from '@/hooks/use-tono'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoLocalDiagnosticsReport,
  tonoRepairService,
  type TonoLocalDiagnosticsReport,
} from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import { TonoConfirmDialog } from '@/tono-ui/TonoAccountCard'
import { TonoIcon } from '@/tono-ui/TonoIcon'

import { healthChecks, healthIsCurrent } from './health-model'

/** Explicit local observation; never poll, repair, connect or upload as part of a check. */
export const HealthCheck = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const [report, setReport] = useState<TonoLocalDiagnosticsReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repairOpen, setRepairOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const current = report != null && healthIsCurrent(report, status)
  const run = useLockFn(async () => {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      setReport(await tonoLocalDiagnosticsReport())
    } catch {
      setError(t('tono.experience.checkFailed'))
    } finally {
      setBusy(false)
    }
  })
  const repair = useLockFn(async () => {
    setRepairing(true)
    setRepairError(null)
    try {
      await tonoRepairService()
      setRepairOpen(false)
      // Repair completion is not verification. Only another explicit read creates evidence.
      setReport(null)
    } catch (cause) {
      setRepairError(formatTonoActionError(cause, t))
    } finally {
      setRepairing(false)
    }
  })
  const buttonStyle = {
    padding: '9px 14px',
    fontSize: 12,
    color: text.primary,
    background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(235,240,250,0.72)',
    border: '1px solid var(--tono-surface-card-border)',
  }
  const local = report?.localEvidence
  const unknown = t('tono.experience.state.unknown')
  return (
    <>
      <GlassCard radius="var(--tono-radius-card)" padding={18}>
        <h2 style={{ margin: '0 0 6px', fontSize: 14, color: text.primary }}>
          {t('tono.experience.healthTitle')}
        </h2>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: text.secondary }}>
          {t('tono.experience.healthDescription')}
        </p>
        <button
          type="button"
          className="tono-button"
          style={buttonStyle}
          onClick={run}
          disabled={busy || repairing}
          aria-busy={busy}
        >
          <TonoIcon name="shieldCheck" size={15} />
          {t(
            busy
              ? 'tono.experience.checking'
              : report || error
                ? 'tono.experience.retryHealth'
                : 'tono.experience.runHealth',
          )}
        </button>
        {error && (
          <p
            role="alert"
            style={{ fontSize: 12, color: 'var(--tono-text-error)' }}
          >
            {error}
          </p>
        )}
        {report && (
          <>
            <p role="status" style={{ fontSize: 11, color: text.secondary }}>
              {t(
                current ? 'tono.experience.checkedAt' : 'tono.experience.stale',
                { time: new Date(report.reportedAtMs).toLocaleString() },
              )}
            </p>
            {current && (
              <div data-testid="tono-health-results">
                {Object.entries(healthChecks(report)).map(([key, value]) => (
                  <div
                    key={key}
                    data-testid={`tono-health-${key}`}
                    style={{
                      borderTop: '1px solid var(--tono-surface-card-border)',
                      padding: '10px 0',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 12,
                      }}
                    >
                      <strong>{t(`tono.experience.check.${key}`)}</strong>
                      <span
                        style={{
                          color:
                            value === 'attention'
                              ? TONO_COLORS.protectedOffline
                              : value === 'observed'
                                ? TONO_COLORS.latencyGood
                                : text.secondary,
                        }}
                      >
                        {t(`tono.experience.state.${value}`)}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: text.secondary,
                      }}
                    >
                      {t(`tono.experience.hint.${key}`)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {current &&
          report?.serviceProtocol == null &&
          status?.uiState === 'notConnected' && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 12, color: text.secondary }}>
                {t('tono.experience.installHint')}
              </p>
              <button
                type="button"
                className="tono-button"
                style={buttonStyle}
                onClick={() => {
                  setRepairError(null)
                  setRepairOpen(true)
                }}
              >
                {t('tono.experience.repair')}
              </button>
            </div>
          )}
      </GlassCard>
      {report && current && (
        <GlassCard radius="var(--tono-radius-card)" padding={18}>
          <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>
            {t('tono.experience.identityTitle')}
          </h2>
          <dl style={{ margin: 0, fontSize: 12 }}>
            {[
              [
                'channel',
                t(
                  local?.buildProvenance === 'candidate'
                    ? 'tono.experience.channelCandidate'
                    : local?.buildProvenance === 'release-workflow'
                      ? 'tono.experience.channelRelease'
                      : local?.buildProvenance === 'development'
                        ? 'tono.experience.channelDevelopment'
                        : 'tono.experience.channelUnknown',
                ),
              ],
              ['source', local?.appBuild ?? unknown],
              [
                'service',
                `${report.serviceProtocol ?? unknown} / ${report.serviceBuild ?? unknown}`,
              ],
              ['coreExpected', local?.expectedCoreVersion ?? unknown],
              ['coreReported', local?.reportedCoreVersion ?? unknown],
              [
                'catalog',
                report.catalogRevision == null
                  ? unknown
                  : String(report.catalogRevision),
              ],
            ].map(([key, value]) => (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(120px, 0.8fr) minmax(0, 1.2fr)',
                  gap: 12,
                  padding: '8px 0',
                }}
              >
                <dt style={{ color: text.secondary }}>
                  {t(`tono.experience.${key}`)}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    overflowWrap: 'anywhere',
                    userSelect: 'text',
                    fontFamily: key === 'source' ? TONO_MONO_STACK : undefined,
                  }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 11,
              lineHeight: 1.5,
              color: text.secondary,
            }}
          >
            {t('tono.experience.identityHint')}
          </p>
        </GlassCard>
      )}
      {repairOpen && (
        <TonoConfirmDialog
          dark={dark}
          title={t('tono.experience.repairTitle')}
          message={t('tono.experience.repairDescription')}
          error={repairError}
          busy={repairing}
          confirmLabel={t(
            repairing ? 'tono.experience.repairing' : 'tono.experience.repair',
          )}
          cancelLabel={t('shared.actions.cancel')}
          onConfirm={repair}
          onCancel={() => {
            if (!repairing) setRepairOpen(false)
          }}
        />
      )}
    </>
  )
}
