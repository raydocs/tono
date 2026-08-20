import { useLockFn } from 'ahooks'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { DialogRef } from '@/components/base'
import { UpdateViewer } from '@/components/setting/mods/update-viewer'
import { useI18n } from '@/hooks/use-i18n'
import { useTonoPreferences } from '@/hooks/use-tono-preferences'
import { useUpdate } from '@/hooks/use-update'
import { resolveLanguage, supportedLanguages } from '@/services/i18n'
import { showNotice } from '@/services/notice-service'
import { setCacheData, useQuery } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  tonoAuditEnabled,
  tonoAuditLogPath,
  tonoPeriodicTelemetryEnabled,
  tonoSetAuditEnabled,
  tonoSetPeriodicTelemetryEnabled,
  tonoNetworkLogUploadEnabled,
  tonoSetNetworkLogUploadEnabled,
} from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { PageHeader } from '@/tono-ui/PageHeader'
import {
  TONO_COLORS,
  TONO_MONO_STACK,
  setGlassTransparency,
  tonoText,
  useGlassTransparency,
} from '@/tono-ui/theme'
import { TonoAccountCard } from '@/tono-ui/TonoAccountCard'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoLogo } from '@/tono-ui/TonoLogo'
import { TonoToggle } from '@/tono-ui/TonoToggle'
import { version } from '@root/package.json'

const tonoAuditEnabledQueryKey = ['tonoAuditEnabled'] as const
const tonoAuditLogPathQueryKey = ['tonoAuditLogPath'] as const
const tonoPeriodicTelemetryEnabledQueryKey = [
  'tonoPeriodicTelemetryEnabled',
] as const
const tonoNetworkLogUploadEnabledQueryKey = [
  'tonoNetworkLogUploadEnabled',
] as const

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
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
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
  children,
}: {
  label: string
  subtitle?: string
  children?: React.ReactNode
}) => {
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  return (
    <div className="tono-row">
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: text.primary }}>
          {label}
        </span>
        {subtitle && (
          <span style={{ fontSize: 11, color: text.secondary }}>
            {subtitle}
          </span>
        )}
      </span>
      {children}
    </div>
  )
}

const GeneralCard = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { preferences, mutatePreferences, patchPreferences } =
    useTonoPreferences()
  const { switchLanguage } = useI18n()
  const transparency = useGlassTransparency()
  const [slider, setSlider] = useState<number | null>(null)
  const themeMode = preferences?.theme_mode ?? 'system'
  const sliderValue = slider ?? transparency

  const handleAutostart = useLockFn(async (value: boolean) => {
    const previous = preferences?.enable_auto_launch ?? false
    mutatePreferences((prev) =>
      prev ? { ...prev, enable_auto_launch: value } : prev,
    )
    try {
      await patchPreferences({ enable_auto_launch: value })
    } catch (error) {
      mutatePreferences((prev) =>
        prev ? { ...prev, enable_auto_launch: previous } : prev,
      )
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

  const handleLanguage = useLockFn(async (language: string) => {
    try {
      await switchLanguage(language)
      await patchPreferences({ language })
    } catch (error) {
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

  const handleThemeMode = useLockFn(
    async (value: 'light' | 'dark' | 'system') => {
      try {
        await patchPreferences({ theme_mode: value })
      } catch (error) {
        showNotice.error(error instanceof Error ? error.message : String(error))
      }
    },
  )

  const handleRefined = useLockFn(async (value: boolean) => {
    try {
      await patchPreferences({ enable_refined_ui: value })
    } catch (error) {
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

  const commitSlider = () => {
    if (slider !== null) {
      setGlassTransparency(slider)
      setSlider(null)
    }
  }

  return (
    <GlassCard>
      <CardHeader
        icon={<TonoIcon name="settings" size={18} />}
        title={t('tono.settings.preferences.title')}
        tint={`${TONO_COLORS.accent}26`}
      />
      <Row label={t('tono.settings.general.launchAtStartup')}>
        <TonoToggle
          checked={preferences?.enable_auto_launch ?? false}
          onChange={(value) => void handleAutostart(value)}
          label={t('tono.settings.general.launchAtStartup')}
        />
      </Row>
      <Row label={t('tono.settings.general.language')}>
        <select
          // The resolved language, not the stored one. `supportedLanguages` is ['en','zh'],
          // so a stored value the app merely *falls back* from — 'jp', 'ko', 'de', and
          // 'zhtw', which resolveLanguage maps to 'zh' — matched no option and left the
          // control blank, showing nothing while the app was plainly running in some
          // language. This shows whichever one is actually running.
          value={resolveLanguage(preferences?.language)}
          onChange={(event) => void handleLanguage(event.target.value)}
          style={{
            fontFamily: 'inherit',
            fontSize: 12,
            padding: '6px 8px',
            borderRadius: 8,
            color: text.primary,
            background: dark
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(255,255,255,0.7)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(20,22,30,0.12)'}`,
          }}
        >
          {supportedLanguages.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code] ?? code}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('tono.settings.appearance.themeMode')}>
        <span
          style={{
            display: 'flex',
            borderRadius: 8,
            overflow: 'hidden',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(20,22,30,0.12)'}`,
          }}
        >
          {(['light', 'dark', 'system'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="tono-link"
              onClick={() => void handleThemeMode(value)}
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
      <Row
        label={t('tono.settings.appearance.glass')}
        subtitle={t('tono.settings.appearance.glassSubtitle')}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            className="tono-range"
            min={0}
            max={100}
            value={sliderValue}
            aria-label={t('tono.settings.appearance.glass')}
            onChange={(event) => setSlider(Number(event.target.value))}
            onPointerUp={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
            style={{
              background: `linear-gradient(to right, ${TONO_COLORS.accent} 0%, ${TONO_COLORS.accent} ${sliderValue}%, rgba(142,142,147,0.35) ${sliderValue}%, rgba(142,142,147,0.35) 100%)`,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontFamily: TONO_MONO_STACK,
              color: text.secondary,
              width: 24,
              textAlign: 'right',
            }}
          >
            {sliderValue}
          </span>
        </span>
      </Row>
      <Row
        label={t('tono.settings.appearance.refined')}
        subtitle={t('tono.settings.appearance.refinedSubtitle')}
      >
        <TonoToggle
          checked={preferences?.enable_refined_ui !== false}
          onChange={(value) => void handleRefined(value)}
          label={t('tono.settings.appearance.refined')}
        />
      </Row>
    </GlassCard>
  )
}

const PrivacyCard = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { data: auditEnabled } = useQuery({
    queryKey: tonoAuditEnabledQueryKey,
    queryFn: tonoAuditEnabled,
  })
  const { data: auditLogInfo } = useQuery({
    queryKey: tonoAuditLogPathQueryKey,
    queryFn: tonoAuditLogPath,
  })
  const { data: periodicTelemetryEnabled } = useQuery({
    queryKey: tonoPeriodicTelemetryEnabledQueryKey,
    queryFn: tonoPeriodicTelemetryEnabled,
  })
  const { data: networkLogUploadEnabled } = useQuery({
    queryKey: tonoNetworkLogUploadEnabledQueryKey,
    queryFn: tonoNetworkLogUploadEnabled,
  })
  const logPath = auditLogInfo?.path

  const handleAudit = useLockFn(async (value: boolean) => {
    const previous = auditEnabled ?? true
    setCacheData(tonoAuditEnabledQueryKey, value)
    try {
      await tonoSetAuditEnabled(value)
    } catch (error) {
      setCacheData(tonoAuditEnabledQueryKey, previous)
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

  const handlePeriodicTelemetry = useLockFn(async (value: boolean) => {
    const previous = periodicTelemetryEnabled ?? true
    setCacheData(tonoPeriodicTelemetryEnabledQueryKey, value)
    try {
      await tonoSetPeriodicTelemetryEnabled(value)
    } catch (error) {
      setCacheData(tonoPeriodicTelemetryEnabledQueryKey, previous)
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

  const handleNetworkLogUpload = useLockFn(async (value: boolean) => {
    const previous = networkLogUploadEnabled ?? true
    setCacheData(tonoNetworkLogUploadEnabledQueryKey, value)
    try {
      await tonoSetNetworkLogUploadEnabled(value)
    } catch (error) {
      setCacheData(tonoNetworkLogUploadEnabledQueryKey, previous)
      showNotice.error(error instanceof Error ? error.message : String(error))
    }
  })

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
      <Row
        label={t('settings.sections.tono.auditLog.label')}
        subtitle={t('settings.sections.tono.auditLog.description')}
      >
        <TonoToggle
          checked={auditEnabled ?? true}
          onChange={(value) => void handleAudit(value)}
          label={t('settings.sections.tono.auditLog.label')}
        />
      </Row>
      <Row
        label={t('settings.sections.tono.periodicTelemetry.label')}
        subtitle={t('settings.sections.tono.periodicTelemetry.description')}
      >
        <TonoToggle
          checked={periodicTelemetryEnabled ?? true}
          onChange={(value) => void handlePeriodicTelemetry(value)}
          label={t('settings.sections.tono.periodicTelemetry.label')}
        />
      </Row>
      <Row
        label={t('settings.sections.tono.networkLogUpload.label')}
        subtitle={t('settings.sections.tono.networkLogUpload.description')}
      >
        <TonoToggle
          checked={networkLogUploadEnabled ?? true}
          onChange={(value) => void handleNetworkLogUpload(value)}
          label={t('settings.sections.tono.networkLogUpload.label')}
        />
      </Row>
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
            style={{ color: TONO_COLORS.accent, display: 'flex' }}
            onClick={handleCopyPath}
          >
            <TonoIcon name="copy" size={14} />
          </button>
        </span>
      </Row>
    </GlassCard>
  )
}

const AboutCard = () => {
  const { t } = useTranslation()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const updateRef = useRef<DialogRef>(null)
  const { checkUpdate, loading } = useUpdate()

  const onCheckUpdate = useLockFn(async () => {
    try {
      const result = await checkUpdate()
      if (result.data?.available) {
        updateRef.current?.open()
      } else {
        showNotice.success('tono.settings.about.latestVersion')
      }
    } catch (error) {
      showNotice.error(error)
    }
  })

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

const SettingPage = () => {
  const { t } = useTranslation()

  return (
    <div className="tono-page">
      <PageHeader title={t('tono.settings.title')} />

      <div style={{ marginBottom: 20 }}>
        <TonoAccountCard />
      </div>

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
      <PrivacyCard />
    </div>
  )
}

export default SettingPage
