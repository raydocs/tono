import { useLockFn } from 'ahooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { DialogRef } from '@/components/base'
import { UpdateViewer } from '@/components/setting/mods/update-viewer'
import { useTonoStatus } from '@/hooks/use-tono'
import {
  useTonoPreferences,
  readGeneralSave,
  tonoGeneralSaveQueryKey,
  type GeneralSave,
} from '@/hooks/use-tono-preferences'
import { useUpdate } from '@/hooks/use-update'
import {
  changeLanguage,
  resolveLanguage,
  supportedLanguages,
} from '@/services/i18n'
import { showNotice } from '@/services/notice-service'
import { getCacheData, setCacheData, useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  tonoAuditEnabled,
  tonoAuditLogPath,
  tonoCatalogStatus,
  tonoCheckTerminalEnv,
  tonoClearTerminalProxyEnv,
  tonoDisableStaleSystemProxy,
  tonoInternalBuild,
  tonoPeriodicTelemetryEnabled,
  tonoSetAuditEnabled,
  tonoSetPeriodicTelemetryEnabled,
  tonoNetworkLogUploadEnabled,
  tonoSetNetworkLogUploadEnabled,
  describeTonoActionError,
  type TonoActionErrorDescription,
} from '@/services/tono'
import { updateCheckNoticeKey } from '@/services/update-copy'
import {
  OPEN_UPDATE_STORAGE_KEY,
  OPEN_UPDATE_WINDOW_EVENT,
} from '@/services/update-prompt'
import { TONO_UPDATES_CONFIGURED } from '@/services/update'
import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { AppearanceCard } from '@/tono-ui/AppearanceCard'
import { GlassCard } from '@/tono-ui/GlassCard'
import { PageHeader } from '@/tono-ui/PageHeader'
import { PrivacyDescription } from '@/tono-ui/PrivacyDescription'
import { SeaButton, SeaSegmented, SeaTag, SeaToggle } from '@/tono-ui/SeaControls'
import { TONO_COLORS, TONO_MONO_STACK, tonoText } from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoLogo } from '@/tono-ui/TonoLogo'
import { TonoToggle } from '@/tono-ui/TonoToggle'
import { version } from '@root/package.json'

import './sea-settings.css'

const tonoAuditEnabledQueryKey = ['tonoAuditEnabled'] as const
const tonoAuditLogPathQueryKey = ['tonoAuditLogPath'] as const
const tonoPeriodicTelemetryEnabledQueryKey = [
  'tonoPeriodicTelemetryEnabled',
] as const
const tonoNetworkLogUploadEnabledQueryKey = [
  'tonoNetworkLogUploadEnabled',
] as const
const tonoInternalBuildQueryKey = ['tonoInternalBuild'] as const
const tonoPrivacySavesQueryKey = ['tonoPrivacySaves'] as const
const tonoSettingsCatalogStatusQueryKey = ['tono', 'catalog-status'] as const
const tonoTerminalEnvQueryKey = ['tono', 'terminal-env'] as const
type PrivacySaves = Record<
  string,
  { phase: 'saving' | 'saved' | 'failed'; error?: TonoActionErrorDescription }
>
const readPrivacySaves = () =>
  getCacheData<PrivacySaves>(tonoPrivacySavesQueryKey) ?? {}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  zh: '简体中文',
}

const CardHeader = ({
  icon,
  title,
  tint,
}: {
  icon: ReactNode
  title: string
  tint: string
}) => {
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  if (newAppearance) return <h2>{title}</h2>
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 10,
          color: 'inherit',
          background: tint,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color: text.primary }}>
        {title}
      </span>
    </div>
  )
}

const Row = ({
  label,
  subtitle,
  feedback,
  children,
}: {
  label: string
  subtitle?: ReactNode
  feedback?: ReactNode
  children?: React.ReactNode
}) => {
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  return (
    <div className="tono-row">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: newAppearance ? 15 : 13,
            fontWeight: newAppearance ? 400 : 500,
            color: text.primary,
          }}
        >
          {label}
        </span>
        {subtitle && (
          <span
            style={{ fontSize: newAppearance ? 12 : 11, color: text.secondary }}
          >
            {subtitle}
          </span>
        )}
        {feedback}
      </div>
      {children}
    </div>
  )
}

export const GeneralCard = () => {
  const { t, i18n } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const Toggle = newAppearance ? SeaToggle : TonoToggle
  const {
    preferences,
    generalSave: save,
    error,
    isFetching,
    refetchPreferences,
    patchPreferences,
  } = useTonoPreferences()
  // All these choices share one native preferences document. Serialize them
  // across routes, including the readback and language application.
  const themeMode = preferences?.theme_mode ?? 'system'
  const selectedLanguage = resolveLanguage(
    preferences?.language ?? i18n.language,
  )
  const disabled =
    !preferences ||
    isFetching ||
    Boolean(error) ||
    save?.phase === 'reading' ||
    save?.phase === 'saving' ||
    save?.phase === 'failed'
  const failure = error ? describeTonoActionError(error, t) : save?.error

  const savePreferences = async (value: Partial<TonoPreferences>) => {
    const phase = readGeneralSave()?.phase
    if (
      disabled ||
      phase === 'reading' ||
      phase === 'saving' ||
      phase === 'failed'
    )
      return
    setCacheData<GeneralSave>(tonoGeneralSaveQueryKey, { phase: 'saving' })
    try {
      const result = await patchPreferences(value)
      if (result.error || !result.data) {
        throw result.error ?? new Error(t('tono.settings.general.readFailed'))
      }
      const confirmed = result.data
      if (
        Object.entries(value).some(
          ([key, requested]) =>
            confirmed[key as keyof TonoPreferences] !== requested,
        )
      ) {
        throw new Error(t('tono.settings.general.saveFailed'))
      }
      if (value.language)
        await changeLanguage(resolveLanguage(result.data.language))
      setCacheData<GeneralSave>(tonoGeneralSaveQueryKey, { phase: 'saved' })
    } catch (cause) {
      setCacheData<GeneralSave>(tonoGeneralSaveQueryKey, {
        phase: 'failed',
        error: describeTonoActionError(cause, t),
      })
    }
  }

  const reloadPreferences = async () => {
    const phase = readGeneralSave()?.phase
    if (phase === 'reading' || phase === 'saving' || isFetching) return
    setCacheData<GeneralSave>(tonoGeneralSaveQueryKey, { phase: 'reading' })
    try {
      const result = await refetchPreferences()
      if (result.error || !result.data) {
        throw result.error ?? new Error(t('tono.settings.general.readFailed'))
      }
      if (result.data.language)
        await changeLanguage(resolveLanguage(result.data.language))
      setCacheData(tonoGeneralSaveQueryKey, undefined)
    } catch (cause) {
      setCacheData<GeneralSave>(tonoGeneralSaveQueryKey, {
        phase: 'failed',
        error: describeTonoActionError(cause, t),
      })
    }
  }

  return (
    <GlassCard>
      <CardHeader
        icon={<TonoIcon name="settings" size={18} />}
        title={t(
          newAppearance
            ? 'tono.settings.general.title'
            : 'tono.settings.preferences.title',
        )}
        tint={`${TONO_COLORS.accent}26`}
      />
      <p className="tono-settings-effect-hint">
        {t('tono.settings.general.effectHint')}
      </p>
      <Row
        label={t('tono.settings.general.routingMode')}
        subtitle={
          (preferences?.desktop_routing_mode ?? 'ai-home') === 'three-tier' ? (
            <>
              {t('tono.settings.general.routingScope')}
              <br />
              {t('tono.settings.general.routingLimits')}
              <br />
              {t('tono.settings.general.routingEffect')}
            </>
          ) : (preferences?.desktop_routing_mode ?? 'ai-home') === 'ai-home' ? (
            <>
              {t('tono.settings.general.routingAiHomeScope')}
              <br />
              {t('tono.settings.general.routingAiHomeLimits')}
              <br />
              {t('tono.settings.general.routingEffect')}
            </>
          ) : (
            <>
              {t('tono.settings.general.routingStableScope')}
              <br />
              {t('tono.settings.general.routingEffect')}
            </>
          )
        }
      >
        {newAppearance ? (
          <SeaSegmented
            label={t('tono.settings.general.routingMode')}
            value={preferences?.desktop_routing_mode ?? 'ai-home'}
            disabled={disabled}
            options={[
              {
                value: 'ai-home',
                label: t('tono.settings.general.routingAiHome'),
              },
              {
                value: 'stable',
                label: t('tono.settings.general.routingStable'),
              },
              {
                value: 'three-tier',
                label: t('tono.settings.general.routingThreeTier'),
              },
            ]}
            onChange={(desktop_routing_mode) =>
              void savePreferences({
                desktop_routing_mode: desktop_routing_mode as
                  | 'ai-home'
                  | 'stable'
                  | 'three-tier',
              })
            }
          />
        ) : (
          <select
            aria-label={t('tono.settings.general.routingMode')}
            value={preferences?.desktop_routing_mode ?? 'ai-home'}
            disabled={disabled}
            style={{ flexShrink: 0 }}
            onChange={(event) =>
              void savePreferences({
                desktop_routing_mode: event.target.value as
                  | 'ai-home'
                  | 'stable'
                  | 'three-tier',
              })
            }
          >
            <option value="ai-home">
              {t('tono.settings.general.routingAiHome')}
            </option>
            <option value="stable">
              {t('tono.settings.general.routingStable')}
            </option>
            <option value="three-tier">
              {t('tono.settings.general.routingThreeTier')}
            </option>
          </select>
        )}
      </Row>
      <Row
        label={t('tono.settings.general.lanAccess')}
        subtitle={t('tono.settings.general.lanAccessHint')}
      >
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 500,
            color: TONO_COLORS.latencyGood,
          }}
        >
          {t('tono.settings.general.lanAlwaysOn')}
        </span>
      </Row>
      <Row
        label={t('tono.settings.general.launchAtStartup')}
        subtitle={t('tono.settings.general.launchAtStartupHint')}
      >
        <Toggle
          checked={preferences?.enable_auto_launch ?? false}
          disabled={disabled}
          onChange={(value) =>
            void savePreferences({ enable_auto_launch: value })
          }
          label={t('tono.settings.general.launchAtStartup')}
        />
      </Row>
      <Row
        label={t('tono.settings.general.language')}
        subtitle={t('tono.settings.general.languageHint')}
      >
        {newAppearance ? (
          <SeaSegmented
            label={t('tono.settings.general.language')}
            value={selectedLanguage}
            disabled={disabled}
            options={supportedLanguages.map((code) => ({
              value: code,
              label: LANGUAGE_LABELS[code] ?? code,
            }))}
            onChange={(language) => void savePreferences({ language })}
          />
        ) : (
          <span className="tono-segmented" style={{ flexShrink: 0 }}>
            {supportedLanguages.map((code) => {
              const active = selectedLanguage === code
              return (
                <button
                  key={code}
                  type="button"
                  className="tono-link"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => void savePreferences({ language: code })}
                  style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    color: active ? '#fff' : text.secondary,
                    background: active ? TONO_COLORS.accent : 'transparent',
                  }}
                >
                  {LANGUAGE_LABELS[code] ?? code}
                </button>
              )
            })}
          </span>
        )}
      </Row>
      {!newAppearance && (
        <Row label={t('tono.settings.appearance.themeMode')}>
          <span className="tono-segmented">
            {(['light', 'dark', 'system'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="tono-link"
                disabled={disabled}
                aria-pressed={themeMode === value}
                onClick={() => void savePreferences({ theme_mode: value })}
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: themeMode === value ? 600 : 400,
                  color: themeMode === value ? '#fff' : text.secondary,
                  background:
                    themeMode === value ? TONO_COLORS.accent : 'transparent',
                }}
              >
                {t(`tono.settings.appearance.theme.${value}`)}
              </button>
            ))}
          </span>
        </Row>
      )}
      {error || save?.phase === 'failed' ? (
        <div className="tono-setting-feedback" role="alert">
          {t(
            save?.phase === 'failed'
              ? 'tono.settings.general.saveFailed'
              : 'tono.settings.general.readFailed',
          )}
          {failure && (
            <span className="tono-setting-error-detail">{failure.message}</span>
          )}
          {failure?.detail && (
            <details className="tono-setting-error-detail">
              <summary>{t('tono.progress.technicalDetails')}</summary>
              <code>{failure.detail}</code>
            </details>
          )}
          <button
            type="button"
            className="tono-link"
            disabled={
              isFetching ||
              save?.phase === 'reading' ||
              save?.phase === 'saving'
            }
            onClick={() => void reloadPreferences()}
          >
            {t(
              isFetching
                ? 'tono.settings.privacy.reading'
                : 'tono.settings.general.reload',
            )}
          </button>
        </div>
      ) : (
        (!preferences || isFetching || save) && (
          <span className="tono-setting-feedback" role="status">
            {t(
              save?.phase === 'saving'
                ? 'tono.settings.privacy.saving'
                : !preferences || isFetching || save?.phase === 'reading'
                  ? 'tono.settings.privacy.reading'
                  : 'tono.settings.privacy.saved',
            )}
          </span>
        )
      )}
    </GlassCard>
  )
}

export const PrivacyCard = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const Toggle = newAppearance ? SeaToggle : TonoToggle
  // The operation outlives this page. Keep its lock/outcome in the existing
  // shared cache so navigating away cannot admit a second write before its ACK.
  const { data: saves = {} } = useQuery({
    queryKey: tonoPrivacySavesQueryKey,
    queryFn: readPrivacySaves,
    initialData: readPrivacySaves,
  })
  const setSaves = (update: (previous: PrivacySaves) => PrivacySaves) =>
    setCacheData<PrivacySaves>(tonoPrivacySavesQueryKey, (previous) =>
      update(previous ?? {}),
    )
  const auditQuery = useQuery({
    queryKey: tonoAuditEnabledQueryKey,
    queryFn: tonoAuditEnabled,
  })
  const { data: auditLogInfo } = useQuery({
    queryKey: tonoAuditLogPathQueryKey,
    queryFn: tonoAuditLogPath,
  })
  const telemetryQuery = useQuery({
    queryKey: tonoPeriodicTelemetryEnabledQueryKey,
    queryFn: tonoPeriodicTelemetryEnabled,
  })
  const networkQuery = useQuery({
    queryKey: tonoNetworkLogUploadEnabledQueryKey,
    queryFn: tonoNetworkLogUploadEnabled,
  })
  const { data: internalBuild } = useQuery({
    queryKey: tonoInternalBuildQueryKey,
    queryFn: tonoInternalBuild,
  })
  const logPath = auditLogInfo?.path

  const saveChoice = async (
    queryKey: readonly [string],
    value: boolean,
    write: (value: boolean) => Promise<void>,
  ) => {
    const key = queryKey[0]
    const phase = readPrivacySaves()[key]?.phase
    if (phase === 'saving' || phase === 'failed') return
    setSaves((previous) => ({ ...previous, [key]: { phase: 'saving' } }))
    try {
      await write(value)
      setCacheData(queryKey, value)
      setSaves((previous) => ({ ...previous, [key]: { phase: 'saved' } }))
    } catch (error) {
      setSaves((previous) => ({
        ...previous,
        [key]: { phase: 'failed', error: describeTonoActionError(error, t) },
      }))
    }
  }

  const handleAudit = useLockFn((value: boolean) =>
    saveChoice(tonoAuditEnabledQueryKey, value, tonoSetAuditEnabled),
  )
  const handlePeriodicTelemetry = useLockFn((value: boolean) =>
    saveChoice(
      tonoPeriodicTelemetryEnabledQueryKey,
      value,
      tonoSetPeriodicTelemetryEnabled,
    ),
  )
  const handleNetworkLogUpload = useLockFn((value: boolean) =>
    saveChoice(
      tonoNetworkLogUploadEnabledQueryKey,
      value,
      tonoSetNetworkLogUploadEnabled,
    ),
  )

  const choiceFeedback = (
    queryKey: readonly [string],
    query: typeof auditQuery,
  ) => {
    const save = saves[queryKey[0]]
    const error = query.error
      ? describeTonoActionError(query.error, t)
      : save?.error
    if (query.error || save?.phase === 'failed') {
      return (
        <div className="tono-setting-feedback" role="alert">
          {t(
            query.error
              ? 'tono.settings.privacy.readFailed'
              : 'tono.settings.privacy.saveFailed',
          )}
          {error && (
            <span className="tono-setting-error-detail">{error.message}</span>
          )}
          {error?.detail && (
            <details className="tono-setting-error-detail">
              <summary>{t('tono.progress.technicalDetails')}</summary>
              <code>{error.detail}</code>
            </details>
          )}
          <button
            type="button"
            className="tono-link"
            disabled={query.isFetching || save?.phase === 'saving'}
            onClick={() => {
              setSaves((previous) => {
                const next = { ...previous }
                delete next[queryKey[0]]
                return next
              })
              void query.refetch()
            }}
          >
            {t(
              query.isFetching
                ? 'tono.settings.privacy.reading'
                : 'tono.settings.privacy.reload',
            )}
          </button>
        </div>
      )
    }
    if (query.isFetching || query.data === undefined || save) {
      return (
        <span className="tono-setting-feedback" role="status">
          {t(
            save?.phase === 'saving'
              ? 'tono.settings.privacy.saving'
              : query.isFetching || query.data === undefined
                ? 'tono.settings.privacy.reading'
                : 'tono.settings.privacy.saved',
          )}
        </span>
      )
    }
    return null
  }

  const choiceDisabled = (
    queryKey: readonly [string],
    query: typeof auditQuery,
  ) =>
    query.data === undefined ||
    query.isFetching ||
    Boolean(query.error) ||
    saves[queryKey[0]]?.phase === 'saving' ||
    saves[queryKey[0]]?.phase === 'failed'

  const handleCopyPath = useLockFn(async () => {
    if (!logPath) return
    try {
      await navigator.clipboard.writeText(logPath)
      showNotice.success('settings.sections.tono.auditLog.copied')
    } catch (error) {
      console.warn('[Settings] copy to clipboard failed:', error)
      showNotice.error('settings.sections.tono.auditLog.copyFailed')
    }
  })

  return (
    <GlassCard>
      <CardHeader
        icon={<TonoIcon name="lock" size={18} />}
        title={t('tono.settings.privacy.title')}
        tint={`${TONO_COLORS.protectedOffline}26`}
      />
      <p className="tono-settings-effect-hint">
        {t('tono.settings.privacy.effectHint')}
      </p>
      {internalBuild && (auditQuery.data ?? true) && (
        <Row label={t('settings.sections.tono.internalDiagnostics')} />
      )}
      <Row
        label={t('settings.sections.tono.auditLog.label')}
        subtitle={
          newAppearance ? (
            <PrivacyDescription
              brief={t('tono.seaSettings.auditBrief')}
              full={t('settings.sections.tono.auditLog.description')}
            />
          ) : (
            t('settings.sections.tono.auditLog.description')
          )
        }
        feedback={choiceFeedback(tonoAuditEnabledQueryKey, auditQuery)}
      >
        <Toggle
          checked={auditQuery.data ?? true}
          disabled={choiceDisabled(tonoAuditEnabledQueryKey, auditQuery)}
          onChange={(value) => void handleAudit(value)}
          label={t('settings.sections.tono.auditLog.label')}
        />
      </Row>
      <Row
        label={t('settings.sections.tono.periodicTelemetry.label')}
        subtitle={
          newAppearance ? (
            <PrivacyDescription
              brief={t('tono.seaSettings.telemetryBrief')}
              full={t('settings.sections.tono.periodicTelemetry.description')}
            />
          ) : (
            t('settings.sections.tono.periodicTelemetry.description')
          )
        }
        feedback={choiceFeedback(
          tonoPeriodicTelemetryEnabledQueryKey,
          telemetryQuery,
        )}
      >
        <Toggle
          checked={telemetryQuery.data ?? true}
          disabled={choiceDisabled(
            tonoPeriodicTelemetryEnabledQueryKey,
            telemetryQuery,
          )}
          onChange={(value) => void handlePeriodicTelemetry(value)}
          label={t('settings.sections.tono.periodicTelemetry.label')}
        />
      </Row>
      <Row
        label={t('settings.sections.tono.networkLogUpload.label')}
        subtitle={
          newAppearance ? (
            <PrivacyDescription
              brief={t('tono.seaSettings.networkBrief')}
              full={t('settings.sections.tono.networkLogUpload.description')}
            />
          ) : (
            t('settings.sections.tono.networkLogUpload.description')
          )
        }
        feedback={choiceFeedback(
          tonoNetworkLogUploadEnabledQueryKey,
          networkQuery,
        )}
      >
        <Toggle
          checked={networkQuery.data ?? false}
          disabled={choiceDisabled(
            tonoNetworkLogUploadEnabledQueryKey,
            networkQuery,
          )}
          onChange={(value) => void handleNetworkLogUpload(value)}
          label={t('settings.sections.tono.networkLogUpload.label')}
        />
      </Row>
      {!newAppearance && (
        <AuditPathRow logPath={logPath} onCopy={handleCopyPath} />
      )}
    </GlassCard>
  )
}

const AuditPathRow = ({
  logPath,
  onCopy,
}: {
  logPath: string | undefined
  onCopy: () => void
}) => {
  const { t } = useTranslation()
  const text = tonoText(useThemeMode() !== 'light')
  const { newAppearance } = useAppearancePreferences()
  return (
    <Row label={t('settings.sections.tono.auditLog.pathLabel')}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: 280,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: TONO_MONO_STACK,
            color: text.tertiary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            direction: 'rtl',
          }}
          title={logPath ?? undefined}
        >
          {logPath ?? '—'}
        </span>
        <button
          type="button"
          className="tono-link"
          aria-label={t('settings.sections.tono.auditLog.copyPath')}
          title={t('settings.sections.tono.auditLog.copyPath')}
          disabled={!logPath}
          style={{
            color: newAppearance ? 'var(--sea-accent)' : TONO_COLORS.accent,
            display: 'flex',
          }}
          onClick={onCopy}
        >
          <TonoIcon name="copy" size={14} />
        </button>
      </span>
    </Row>
  )
}

const AboutCard = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { data: auditLogInfo } = useQuery({
    queryKey: tonoAuditLogPathQueryKey,
    queryFn: tonoAuditLogPath,
  })
  const handleCopyPath = useLockFn(async () => {
    if (!auditLogInfo?.path) return
    try {
      await navigator.clipboard.writeText(auditLogInfo.path)
      showNotice.success('settings.sections.tono.auditLog.copied')
    } catch {
      showNotice.error('settings.sections.tono.auditLog.copyFailed')
    }
  })
  const updateRef = useRef<DialogRef>(null)
  const { checkUpdate, loading } = useUpdate()

  useEffect(() => {
    const openIfAsked = () => {
      if (sessionStorage.getItem(OPEN_UPDATE_STORAGE_KEY) !== '1') return
      sessionStorage.removeItem(OPEN_UPDATE_STORAGE_KEY)
      updateRef.current?.open()
    }
    openIfAsked()
    window.addEventListener(OPEN_UPDATE_WINDOW_EVENT, openIfAsked)
    return () =>
      window.removeEventListener(OPEN_UPDATE_WINDOW_EVENT, openIfAsked)
  }, [])

  const onCheckUpdate = useLockFn(async () => {
    if (!TONO_UPDATES_CONFIGURED) {
      showNotice.info('tono.settings.about.updatesUnavailable')
      return
    }
    try {
      const result = await checkUpdate()
      if (result.error !== undefined) {
        const raw =
          result.error instanceof Error
            ? result.error.message
            : String(result.error)
        showNotice.error(updateCheckNoticeKey(raw))
      } else if (result.data) {
        updateRef.current?.open()
      } else {
        showNotice.success('tono.settings.about.latestVersion')
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? '')
      showNotice.error(updateCheckNoticeKey(raw))
    }
  })

  if (newAppearance)
    return (
      <>
        <UpdateViewer ref={updateRef} />
        <GlassCard>
          <h2>{t('tono.settings.about.title')}</h2>
          <div className="sea-settings-about-head">
            <TonoLogo connected={false} size={44} variant="sun" />
            <div>
              <span>Tono v{version}</span>
              <p>{t('tono.settings.about.tagline')}</p>
            </div>
            <button
              type="button"
              className="sea-button"
              data-variant="text"
              disabled={loading}
              aria-busy={loading}
              onClick={() => void onCheckUpdate()}
            >
              {t('tono.settings.about.checkUpdates')}
            </button>
          </div>
          <p className="sea-settings-about-copy">
            {t('tono.settings.about.description')}
          </p>
          <p className="sea-settings-about-copy">
            {t('tono.settings.about.unsigned')}
          </p>
          <AuditPathRow logPath={auditLogInfo?.path} onCopy={handleCopyPath} />
        </GlassCard>
      </>
    )

  return (
    <>
      <UpdateViewer ref={updateRef} />
      <GlassCard
        style={{
          background: `linear-gradient(135deg, ${TONO_COLORS.accent}1A 0%, ${TONO_COLORS.protectedOffline}1A 100%), ${
            dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.4)'
          }`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        <TonoLogo connected compact={false} size={56} />
        <span style={{ fontSize: 15, fontWeight: 600, color: text.primary }}>
          Tono v{version}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: text.secondary }}>
          {t('tono.settings.about.tagline')}
        </span>
        <span style={{ fontSize: 11, color: text.tertiary, maxWidth: 260 }}>
          {t('tono.settings.about.description')}
        </span>
        <span style={{ fontSize: 11, color: text.tertiary, maxWidth: 280 }}>
          {t('tono.settings.about.unsigned')}
        </span>
        <button
          type="button"
          className="tono-link"
          disabled={loading}
          onClick={() => void onCheckUpdate()}
        >
          {t('tono.settings.about.checkUpdates')}
        </button>
      </GlassCard>
    </>
  )
}

export const SystemCompatibilityCard = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status } = useTonoStatus()
  const [clearingProxy, setClearingProxy] = useState(false)
  const [proxyFeedback, setProxyFeedback] = useState<string | null>(null)
  const [proxyError, setProxyError] =
    useState<TonoActionErrorDescription | null>(null)
  const [clearingEnv, setClearingEnv] = useState(false)
  const [envFeedback, setEnvFeedback] = useState<string | null>(null)
  const [envError, setEnvError] = useState<TonoActionErrorDescription | null>(
    null,
  )

  const { data: catalog, refetch: refetchCatalog } = useQuery({
    queryKey: tonoSettingsCatalogStatusQueryKey,
    queryFn: tonoCatalogStatus,
  })
  const terminalEnvQuery = useQuery({
    queryKey: tonoTerminalEnvQueryKey,
    queryFn: tonoCheckTerminalEnv,
  })

  const staleProxyServer = catalog?.staleSystemProxy
    ? catalog.staleSystemProxy.replace(/^TONO_STALE_SYSTEM_PROXY:\s*/, '')
    : null
  const terminalEnv = terminalEnvQuery.data
  const conflictKeys =
    terminalEnv?.entries.map((entry) => entry.key).join(', ') ||
    'HTTP_PROXY, HTTPS_PROXY'

  const handleClearProxy = useLockFn(async () => {
    setClearingProxy(true)
    setProxyFeedback(null)
    setProxyError(null)
    try {
      await tonoDisableStaleSystemProxy()
      await refetchCatalog()
      setProxyFeedback(t('tono.settings.compatibility.systemProxyCleared'))
    } catch (error) {
      setProxyError(describeTonoActionError(error, t))
    } finally {
      setClearingProxy(false)
    }
  })

  const handleClearTerminalEnv = useLockFn(async () => {
    setClearingEnv(true)
    setEnvFeedback(null)
    setEnvError(null)
    try {
      await tonoClearTerminalProxyEnv()
      await terminalEnvQuery.refetch()
      setEnvFeedback(t('tono.settings.compatibility.terminalEnvCleared'))
    } catch (error) {
      setEnvError(describeTonoActionError(error, t))
    } finally {
      setClearingEnv(false)
    }
  })

  const renderBadge = (label: string, good: boolean, warn = false) => {
    if (newAppearance) {
      return <SeaTag kind={good ? 'good' : 'quiet'}>{label}</SeaTag>
    }
    const tone = warn
      ? TONO_COLORS.error
      : good
        ? TONO_COLORS.latencyGood
        : text.secondary
    return (
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 600,
          color: tone,
        }}
      >
        {label}
      </span>
    )
  }

  const renderAction = (
    label: string,
    onClick: () => void,
    disabled: boolean,
  ) => {
    if (newAppearance) {
      return (
        <SeaButton disabled={disabled} onClick={onClick}>
          {label}
        </SeaButton>
      )
    }
    return (
      <button
        type="button"
        className="tono-button"
        disabled={disabled}
        onClick={onClick}
        style={{
          padding: '6px 12px',
          fontSize: 11,
          color: text.primary,
          background: dark
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(255,255,255,0.62)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(56,72,108,0.1)'}`,
        }}
      >
        {label}
      </button>
    )
  }

  const claudeBadgeLabel =
    status?.uiState === 'connected'
      ? status.claudeHomeActive !== false
        ? t('tono.settings.compatibility.claudeHomeActive')
        : t('tono.settings.compatibility.claudeHomeCloudOnly')
      : t('tono.settings.compatibility.claudeHomeStandby')
  const claudeBadgeGood =
    status?.uiState === 'connected' && status.claudeHomeActive !== false

  const dnsWarning = status?.resolverPolicyWarning
  const dnsVerified =
    !dnsWarning &&
    status?.uiState === 'connected' &&
    Boolean(status?.killSwitch?.live)

  return (
    <GlassCard>
      <CardHeader
        icon={<TonoIcon name="globe" size={18} />}
        title={t('tono.settings.compatibility.title')}
        tint={`${TONO_COLORS.latencyGood}26`}
      />
      <p className="tono-settings-effect-hint">
        {t('tono.settings.compatibility.effectHint')}
      </p>
      <Row
        label={t('tono.settings.compatibility.claudeHomeLabel')}
        subtitle={t('tono.settings.compatibility.claudeHomeHint')}
      >
        {renderBadge(claudeBadgeLabel, claudeBadgeGood)}
      </Row>
      <Row
        label={t('tono.settings.compatibility.systemProxyLabel')}
        subtitle={
          staleProxyServer
            ? t('tono.settings.compatibility.systemProxyStaleHint', {
                server: staleProxyServer,
              })
            : t('tono.settings.compatibility.systemProxyCleanHint')
        }
        feedback={
          proxyError ? (
            <div className="tono-setting-feedback" role="alert">
              {proxyError.message}
            </div>
          ) : proxyFeedback ? (
            <span className="tono-setting-feedback" role="status">
              {proxyFeedback}
            </span>
          ) : null
        }
      >
        {staleProxyServer
          ? renderAction(
              t('tono.settings.compatibility.systemProxyClear'),
              () => void handleClearProxy(),
              clearingProxy,
            )
          : renderBadge(t('tono.settings.compatibility.systemProxyClean'), true)}
      </Row>
      <Row
        label={t('tono.settings.compatibility.terminalEnvLabel')}
        subtitle={
          terminalEnv?.hasConflict
            ? t('tono.settings.compatibility.terminalEnvConflictHint', {
                keys: conflictKeys,
              })
            : t('tono.settings.compatibility.terminalEnvCleanHint')
        }
        feedback={
          envError ? (
            <div className="tono-setting-feedback" role="alert">
              {envError.message}
            </div>
          ) : envFeedback ? (
            <span className="tono-setting-feedback" role="status">
              {envFeedback}
            </span>
          ) : null
        }
      >
        {terminalEnv?.hasConflict || terminalEnvQuery.error ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
            {terminalEnv?.hasConflict &&
              terminalEnv.canAutoClear &&
              renderAction(
                t('tono.settings.compatibility.terminalEnvClear'),
                () => void handleClearTerminalEnv(),
                clearingEnv || terminalEnvQuery.isFetching,
              )}
            {renderAction(
              t('tono.settings.compatibility.terminalEnvRecheck'),
              () => void terminalEnvQuery.refetch(),
              clearingEnv || terminalEnvQuery.isFetching,
            )}
          </span>
        ) : (
          renderBadge(t('tono.settings.compatibility.terminalEnvReady'), true)
        )}
      </Row>
      <Row
        label={t('tono.settings.compatibility.dnsIpv6Label')}
        subtitle={t('tono.settings.compatibility.dnsIpv6Hint')}
      >
        {dnsWarning
          ? renderBadge(
              t('tono.settings.compatibility.dnsIpv6Warning', {
                warning: dnsWarning,
              }),
              false,
              true,
            )
          : renderBadge(
              dnsVerified
                ? t('tono.settings.compatibility.dnsIpv6Verified')
                : t('tono.settings.compatibility.dnsIpv6Standby'),
              dnsVerified,
            )}
      </Row>
    </GlassCard>
  )
}

const SettingPage = () => {
  const { t } = useTranslation()
  const { newAppearance } = useAppearancePreferences()
  if (newAppearance)
    return (
      <div className="tono-page sea-settings">
        <PageHeader title={t('tono.settings.title')} />
        <div className="sea-settings-groups">
          <GeneralCard />
          <SystemCompatibilityCard />
          <AppearanceCard />
          <PrivacyCard />
          <AboutCard />
        </div>
      </div>
    )

  return (
    <div className="tono-page">
      <PageHeader title={t('tono.settings.title')} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 18,
          alignItems: 'stretch',
          marginBottom: 18,
        }}
      >
        <GeneralCard />
        <AboutCard />
      </div>
      <div style={{ marginBottom: 18 }}>
        <SystemCompatibilityCard />
      </div>
      <AppearanceCard />
      <PrivacyCard />
    </div>
  )
}

export default SettingPage
