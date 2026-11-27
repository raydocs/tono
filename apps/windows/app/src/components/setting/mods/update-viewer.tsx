import { open as openUrl } from '@tauri-apps/plugin-shell'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { useLockFn } from 'ahooks'
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Options as ReactMarkdownOptions } from 'react-markdown'

import type { DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'
import { showNotice } from '@/services/notice-service'
import {
  setUpdateProgress,
  useSetUpdateState,
  useUpdateState,
} from '@/services/states'
import {
  cancelUpdateDownload,
  installUpdate,
  UPDATE_DOWNLOAD_CANCELLED,
} from '@/services/update'
import { describeUpdateFailure } from '@/services/update-copy'
import { TONO_MONO_STACK } from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoLogo } from '@/tono-ui/TonoLogo'
import { version as appVersion } from '@root/package.json'

import './update-viewer.css'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hProperties?: Record<string, unknown>
  }
}

const GITHUB_ALERTS = {
  note: {
    labelKey: 'settings.modals.update.alerts.note',
  },
  tip: {
    labelKey: 'settings.modals.update.alerts.tip',
  },
  important: {
    labelKey: 'settings.modals.update.alerts.important',
  },
  warning: {
    labelKey: 'settings.modals.update.alerts.warning',
  },
  caution: {
    labelKey: 'settings.modals.update.alerts.caution',
  },
} as const

type GitHubAlertType = keyof typeof GITHUB_ALERTS

const GITHUB_ALERT_PATTERN =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*\n?/i

const LazyReactMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: rehypeRaw }] =
    await Promise.all([import('react-markdown'), import('rehype-raw')])

  return {
    default: (props: ReactMarkdownOptions) => (
      <ReactMarkdown {...props} rehypePlugins={[rehypeRaw]} />
    ),
  }
})

const findFirstTextNode = (node: MarkdownNode): MarkdownNode | null => {
  if (node.type === 'text') return node
  for (const child of node.children ?? []) {
    const result = findFirstTextNode(child)
    if (result) return result
  }
  return null
}

const remarkGitHubAlerts = (labels: Record<GitHubAlertType, string>) => {
  const visit = (node: MarkdownNode) => {
    for (const child of node.children ?? []) {
      visit(child)
    }

    if (node.type !== 'blockquote') return

    const firstTextNode = findFirstTextNode(node)
    const match = firstTextNode?.value?.match(GITHUB_ALERT_PATTERN)
    if (!firstTextNode?.value || !match) return

    const alertType = match[1].toLowerCase() as GitHubAlertType
    firstTextNode.value = firstTextNode.value
      .replace(GITHUB_ALERT_PATTERN, '')
      .replace(/^\n+/, '')

    node.data = {
      ...(node.data ?? {}),
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        className: ['markdown-alert', `markdown-alert-${alertType}`],
      },
    }

    node.children?.unshift({
      type: 'paragraph',
      data: {
        hProperties: {
          className: 'markdown-alert-title',
        },
      },
      children: [
        {
          type: 'text',
          value: labels[alertType],
        },
      ],
    })
  }

  return visit
}

const formatMegabytes = (bytes: number) =>
  `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`

export function UpdateViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const titleId = useId()

  const [open, setOpen] = useState(false)
  const updateState = useUpdateState()
  const setUpdateState = useSetUpdateState()

  const { updateInfo } = useUpdate()

  const [failedOffer, setFailedOffer] = useState<{
    manifestSha256: string
    message: string
    detail: string
    sticks: boolean
  } | null>(null)
  const refusal =
    failedOffer?.manifestSha256 === updateInfo?.manifestSha256
      ? failedOffer
      : null
  const blocked = refusal?.sticks === true
  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal] = useState(0)
  const downloadedRef = useRef(0)
  const totalRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const progress = useMemo(() => {
    if (total <= 0) return 0
    return Math.min(Math.round((downloaded / total) * 100), 100)
  }, [downloaded, total])

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  useEffect(() => {
    if (!updateState) {
      setUpdateProgress(null)
      return
    }
    setUpdateProgress(total > 0 ? progress : null)
  }, [updateState, total, progress])

  useEffect(() => () => setUpdateProgress(null), [])

  const githubAlertLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(GITHUB_ALERTS).map(([type, alert]) => [
          type,
          t(alert.labelKey),
        ]),
      ) as Record<GitHubAlertType, string>,
    [t],
  )
  const remarkGitHubAlertsPlugin = useMemo(
    () => () => remarkGitHubAlerts(githubAlertLabels),
    [githubAlertLabels],
  )

  const markdownContent = useMemo(
    () => updateInfo?.body?.trim() ?? '',
    [updateInfo],
  )

  const breakChangeFlag = useMemo(() => {
    if (!updateInfo?.body) {
      return false
    }
    return updateInfo.body.toLowerCase().includes('break change')
  }, [updateInfo])

  const handleCancel = () => {
    // Cancel stops a download in flight instead of leaving it running unseen.
    if (updateState) void cancelUpdateDownload().catch(() => false)
    setOpen(false)
  }

  const cancelFromKeyboard = useEffectEvent(handleCancel)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelFromKeyboard()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      if (!panel.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])

  const onUpdate = useLockFn(async () => {
    if (!updateInfo || blocked) return
    if (breakChangeFlag) {
      showNotice.error('settings.modals.update.messages.breakChangeError')
      return
    }
    if (updateState) return
    setUpdateState(true)
    setDownloaded(0)
    setTotal(0)
    downloadedRef.current = 0
    totalRef.current = 0

    const onDownloadEvent = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        const contentLength = event.data.contentLength ?? 0
        totalRef.current = contentLength
        setTotal(contentLength)
        setDownloaded(0)
        downloadedRef.current = 0
        return
      }

      if (event.event === 'Progress') {
        setDownloaded((prev) => {
          const next = prev + event.data.chunkLength
          downloadedRef.current = next
          return next
        })
      }

      if (event.event === 'Finished' && totalRef.current === 0) {
        totalRef.current = downloadedRef.current
        setTotal(downloadedRef.current)
      }
    }

    try {
      // The native caller transports bytes; Service owns staging, quiescence,
      // one-use installation and authenticated successor recovery.
      await installUpdate(updateInfo.manifestSha256, onDownloadEvent)
    } catch (err) {
      // The user cancelled the download: not a refusal, the same offer may start again.
      if (String(err).includes(UPDATE_DOWNLOAD_CANCELLED)) return
      // Only a marked download-phase transport failure keeps Update now.
      // Needs-attention and a Service refusal stay blocked for this manifest.
      const described = describeUpdateFailure(err, t)
      setFailedOffer({
        manifestSha256: updateInfo.manifestSha256,
        message: described.message,
        detail: described.detail,
        sticks: described.sticks,
      })
    } finally {
      setUpdateState(false)
      setDownloaded(0)
      setTotal(0)
      downloadedRef.current = 0
      totalRef.current = 0
    }
  })

  if (!open) return null

  const targetVersion = updateInfo?.version ?? ''
  const releaseUrl = targetVersion
    ? `https://github.com/raydocs/tono/releases/tag/v${targetVersion}`
    : 'https://github.com/raydocs/tono/releases'

  return (
    <div className="tono-update-backdrop">
      <button
        type="button"
        className="tono-update-scrim"
        tabIndex={-1}
        aria-hidden="true"
        onClick={handleCancel}
      />
      <div
        ref={panelRef}
        className="tono-update-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="tono-update-header">
          <div className="tono-update-identity">
            <TonoLogo connected={false} size={28} variant="sun" />
            <div className="tono-update-title-wrap">
              <h2 id={titleId} className="tono-update-title">
                {t('settings.modals.update.title', { version: targetVersion })}
              </h2>
              <span
                className="tono-update-version-chip"
                style={{ fontFamily: TONO_MONO_STACK }}
              >
                {targetVersion
                  ? `v${appVersion} → v${targetVersion}`
                  : `v${appVersion}`}
              </span>
            </div>
          </div>
          <div className="tono-update-header-actions">
            <button
              type="button"
              className="tono-update-release-btn"
              onClick={() => {
                void Promise.resolve(openUrl(releaseUrl)).catch(() => {})
              }}
            >
              <span>{t('settings.modals.update.actions.goToRelease')}</span>
              <span aria-hidden="true">↗</span>
            </button>
            <button
              type="button"
              className="tono-update-close-btn"
              aria-label={t('shared.actions.close')}
              title={t('shared.actions.close')}
              onClick={handleCancel}
            >
              <TonoIcon name="close" size={14} />
            </button>
          </div>
        </div>

        <div className="tono-update-protection">
          <TonoIcon name="lock" size={14} />
          <span>{t('tono.update.protectionNote')}</span>
        </div>

        {markdownContent ? (
          <div className="tono-update-notes">
            <Suspense fallback={<div className="tono-update-notes-loading" />}>
              <LazyReactMarkdown
                remarkPlugins={[remarkGitHubAlertsPlugin]}
                components={{
                  a: ({ ...props }) => {
                    const { children } = props
                    return (
                      <a {...props} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    )
                  },
                  blockquote: ({ className, children }) => (
                    <blockquote className={className}>{children}</blockquote>
                  ),
                }}
              >
                {markdownContent}
              </LazyReactMarkdown>
            </Suspense>
          </div>
        ) : (
          <p className="tono-update-summary">
            {t('settings.modals.update.messages.available')}
          </p>
        )}

        {refusal && (
          <div className="tono-update-alert" role="alert">
            <p>{refusal.message}</p>
            {refusal.detail && refusal.detail !== refusal.message && (
              <details className="tono-update-details">
                <summary>{t('tono.update.technicalDetails')}</summary>
                <pre>{refusal.detail}</pre>
              </details>
            )}
          </div>
        )}

        {updateState && (
          <div className="tono-update-progress">
            <div className="tono-update-progress-head">
              <span>{t('tono.update.downloading')}</span>
              <span
                className="tono-update-progress-meta"
                style={{ fontFamily: TONO_MONO_STACK }}
              >
                {total > 0
                  ? `${formatMegabytes(downloaded)} / ${formatMegabytes(total)} · ${progress}%`
                  : downloaded > 0
                    ? formatMegabytes(downloaded)
                    : t('tono.update.preparing')}
              </span>
            </div>
            <div
              className="tono-update-progress-track"
              role="progressbar"
              aria-label={t('tono.update.downloading')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={total > 0 ? progress : undefined}
            >
              <div
                className="tono-update-progress-fill"
                data-indeterminate={total <= 0 ? 'true' : undefined}
                style={total > 0 ? { width: `${progress}%` } : undefined}
              />
            </div>
          </div>
        )}

        <div className="tono-update-footer">
          <button
            type="button"
            className="tono-update-btn-secondary"
            onClick={handleCancel}
          >
            {updateState
              ? t('shared.actions.cancel')
              : t('settings.modals.update.actions.later')}
          </button>
          {!blocked && (
            <button
              type="button"
              className="tono-update-btn-primary"
              aria-busy={updateState || undefined}
              aria-disabled={updateState || undefined}
              onClick={() => void onUpdate()}
            >
              {t('settings.modals.update.actions.update')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
