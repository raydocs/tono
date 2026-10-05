import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { tonoConnectProgressQueryKey } from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import { tonoConnectProgress, type TonoStatus } from '@/services/tono'
import {
  markFirstConnectedHintSeen,
  readAppearancePreferences,
} from '@/tono-ui/appearance-preferences'
import { CONNECT_STAGE_LABEL_KEYS } from '@/tono-ui/connect-stages'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'
import { SeaScene, type SeaPhase } from '@/tono-ui/SeaScene'
import { TONO_FONT_STACK } from '@/tono-ui/theme'

import { useHomeDialog } from './home-focus'
import { HomeLines } from './home-lines'
import {
  HOME_CONNECT_TIMES,
  useHomeTiming,
  useRetryCountdown,
} from './home-timing'
import { nodeCityLabel, nodeCityParts } from './node-meta'

import './sea-home.css'

const stages = Object.keys(CONNECT_STAGE_LABEL_KEYS)
const TextSwap = ({
  text,
  transitionKey = text,
}: {
  text: string
  transitionKey?: string
}) => {
  const [swap, setSwap] = useState({ text, key: transitionKey, previous: '' })
  if (text !== swap.text || transitionKey !== swap.key)
    setSwap({
      text,
      key: transitionKey,
      previous: transitionKey !== swap.key ? swap.text : '',
    })
  return (
    <span className="tono-home__text-swap">
      {swap.previous && (
        <span
          key={`old-${swap.previous}`}
          className="tono-home__text-out"
          aria-hidden="true"
        >
          {swap.previous}
        </span>
      )}
      <span key={transitionKey} className="tono-home__text-in">
        {text}
      </span>
    </span>
  )
}

/** Keep a departing card inert for its short exit, without delaying the next action. */
export const HomeAttention = ({ children }: { children: ReactNode }) => {
  const [retained, setRetained] = useState(children)
  const shown = Boolean(children)
  if (shown && retained !== children) setRetained(children)
  useEffect(() => {
    if (shown || !retained) return
    const timer = window.setTimeout(() => setRetained(null), 160)
    return () => window.clearTimeout(timer)
  }, [shown, retained])
  if (!shown && !retained) return null
  return (
    <div
      className="tono-home__attention-slot"
      data-shown={shown}
      aria-hidden={!shown}
      inert={!shown}
    >
      {shown ? children : retained}
    </div>
  )
}

export const SeaHome = ({
  status,
  connectHint,
  failedAction,
  onPrimary,
  onRestore,
  refreshStatus,
  attention,
  details,
  traffic,
  aiTotal,
  releaseDialog,
}: {
  status: TonoStatus | undefined
  connectHint: string
  failedAction: boolean
  onPrimary: (failed: boolean) => void
  onRestore: () => void
  refreshStatus: () => Promise<unknown>
  attention: ReactNode
  details: ReactNode
  traffic: string
  aiTotal: string | null
  releaseDialog: ReactNode
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const attentionRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const [sheetHeight, setSheetHeight] = useState(240)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [linesOpen, setLinesOpen] = useState(false)
  const [firstVisit] = useState(
    () => !readAppearancePreferences().firstConnectedHintSeen,
  )
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const closeLines = useCallback(() => setLinesOpen(false), [])
  const state = status?.uiState ?? 'notConnected'
  const protectedNow = state === 'connected' && hasLiveProtection(status)
  const { data: progress } = useQuery({
    queryKey: tonoConnectProgressQueryKey,
    queryFn: tonoConnectProgress,
  })
  const retrySeconds = useRetryCountdown(progress?.nextRetryAtMs)
  const releasedFailure = state === 'notConnected' && progress?.error != null
  const failed = failedAction || releasedFailure
  const phase: SeaPhase = protectedNow
    ? 'connected'
    : state === 'connecting'
      ? 'connecting'
      : state === 'protectedOffline' ||
          state === 'connected' ||
          (state === 'notConnected' && failed)
        ? 'failed'
        : 'idle'
  const stageIndex = status?.stage ? stages.indexOf(status.stage) : -1
  const { elapsed, minutes } = useHomeTiming(status, progress)
  const stageSentence = t(
    status?.stage
      ? (CONNECT_STAGE_LABEL_KEYS[status.stage] ??
          'tono.dashboard.taglineConnecting')
      : 'tono.dashboard.taglineConnecting',
  )
  const title = t(
    state === 'notConnected'
      ? failed
        ? 'tono.home.title.failed'
        : 'tono.home.title.idle'
      : state === 'connected' && !protectedNow
        ? 'tono.pill.title.protectionUnknown'
        : state === 'protectedOffline' && !hasLiveProtection(status)
          ? 'tono.pill.title.protectionUnknown'
          : state === 'connecting'
            ? 'tono.pill.title.connecting'
            : state === 'disconnecting'
              ? 'tono.pill.title.disconnecting'
              : state === 'protectedOffline'
                ? 'tono.pill.title.protectedOffline'
                : 'tono.pill.title.connected',
  )
  const sentence =
    state === 'connecting'
      ? elapsed >= HOME_CONNECT_TIMES.slow
        ? t('tono.home.slow.sentence', { stage: stageSentence })
        : stageSentence
      : state === 'disconnecting'
        ? t('tono.pill.subtitle.restoringAccess')
        : state === 'protectedOffline'
          ? t(
              hasLiveProtection(status)
                ? progress == null
                  ? 'tono.home.retry.checking'
                  : retrySeconds == null
                    ? 'tono.home.retry.unscheduled'
                    : retrySeconds > 0
                      ? 'tono.home.retry.scheduled'
                      : 'tono.home.retry.now'
                : 'tono.progress.protectionUnknownBody',
              { seconds: retrySeconds },
            )
          : state === 'connected'
            ? protectedNow
              ? `${connectHint} ${minutes < 1 ? t('tono.home.duration.justConnected') : t(minutes === 1 ? 'tono.home.duration.minutes_one' : 'tono.home.duration.minutes_other', { count: minutes })}`
              : t('tono.progress.protectionUnknownBody')
            : failed
              ? t('tono.progress.releasedFailureBody')
              : t('tono.home.sentence.idle')
  const action = t(
    state === 'connecting'
      ? 'tono.dashboard.cancelConnecting'
      : state === 'disconnecting'
        ? 'tono.pill.title.disconnecting'
        : state === 'protectedOffline'
          ? 'tono.progress.retryNow'
          : state === 'connected'
            ? 'tono.tray.disconnect'
            : failed
              ? 'tono.dashboard.errorRetry'
              : 'tono.tray.connect',
  )
  const longTitle = /\p{Script=Han}/u.test(title)
    ? title.length > 4
    : title.length > 12
  const selected = status?.selectedServer
  const delay = status?.exitDelayMs
  const lineName = selected
    ? nodeCityParts(selected).codename || nodeCityLabel(selected, t)
    : t('tono.home.pickLine')
  const lineDetail =
    selected && nodeCityParts(selected).codename
      ? nodeCityLabel(selected, t)
      : ''

  useEffect(() => {
    if (protectedNow && firstVisit) markFirstConnectedHintSeen()
  }, [protectedNow, firstVisit])
  useLayoutEffect(() => {
    const place = () => {
      const bounds = rootRef.current?.getBoundingClientRect()
      const actions = actionsRef.current?.getBoundingClientRect()
      if (!bounds || !actions) return
      // The sheet must never cover the primary controls, even beside the old sidebar.
      const available = Math.max(0, bounds.bottom - actions.bottom - 38)
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- measured layout constraint is committed before paint, not an animation loop
      setSheetHeight(Math.min(310, bounds.height * 0.42, available))
      if (attentionRef.current)
        rootRef.current?.style.setProperty(
          '--tono-home-attention-room',
          `${Math.max(0, bounds.bottom - 60 - attentionRef.current.getBoundingClientRect().top)}px`,
        )
    }
    place()
    const observer = new ResizeObserver(place)
    for (const element of [
      rootRef.current,
      columnRef.current,
      actionsRef.current,
      attentionRef.current,
    ])
      if (element) observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useHomeDialog(sheetOpen, sheetRef, detailsTriggerRef, closeSheet)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        sheetOpen ||
        linesOpen ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      if (event.key !== 'Enter' && event.key !== ' ') return
      const focused = document.activeElement
      if (focused && focused !== document.body && focused !== rootRef.current)
        return
      event.preventDefault()
      primaryRef.current?.click()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen, linesOpen])

  const lineChip = (
    <button
      ref={chipRef}
      type="button"
      data-testid="tono-home-line-chip"
      className="tono-home__chip tono-home__quiet"
      aria-haspopup="dialog"
      aria-expanded={linesOpen}
      onClick={() => {
        if (!selected) {
          navigate('/servers')
          return
        }
        closeSheet()
        setLinesOpen(true)
      }}
      title={selected ?? undefined}
    >
      <span
        className="tono-home__dot"
        data-lit={protectedNow}
        aria-hidden="true"
      />
      <span className="tono-home__line-name">{lineName}</span>
      {selected && (
        <small>
          {lineDetail}
          {lineDetail && delay != null ? ' · ' : ''}
          {delay != null ? `${delay} ms` : ''}
        </small>
      )}
      <span className="tono-home__chevron" aria-hidden="true">
        ⌄
      </span>
    </button>
  )

  return (
    <div
      ref={rootRef}
      className="tono-home"
      data-state={state}
      data-tone={phase === 'idle' ? 'cool' : 'warm'}
      data-tono-theme="dark"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        width: '100%',
        overflow: 'hidden',
        color: '#F6F2EC',
        fontFamily: TONO_FONT_STACK,
      }}
    >
      <SeaScene
        phase={phase}
        progress={stageIndex < 0 ? undefined : stageIndex / stages.length}
      />
      <div
        ref={columnRef}
        className="tono-home__column"
        inert={sheetOpen || linesOpen}
        style={{
          position: 'absolute',
          left: 56,
          top: '22%',
          width: 'min(48%, 440px)',
          maxHeight: 'calc(78% - 60px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h1
          aria-live="polite"
          aria-atomic="true"
          className="tono-home__title"
          data-long={longTitle}
          style={{ fontSize: longTitle ? 48 : 64 }}
        >
          <TextSwap text={title} />
        </h1>
        <p className="tono-home__sentence" data-testid="tono-home-sentence">
          <TextSwap
            text={sentence}
            transitionKey={`${state}:${phase}:${state === 'connecting' ? `${status?.stage}:${elapsed >= HOME_CONNECT_TIMES.slow}` : ''}`}
          />
        </p>
        {state === 'connecting' && (
          <div className="tono-home__steps" aria-hidden="true">
            {stages.map((stage, index) => (
              <span
                key={stage}
                data-step={
                  index < stageIndex
                    ? 'done'
                    : index === stageIndex
                      ? 'current'
                      : 'pending'
                }
              />
            ))}
          </div>
        )}
        <div ref={actionsRef} className="tono-home__actions">
          <button
            ref={primaryRef}
            type="button"
            className={`tono-home__pill ${state === 'notConnected' || state === 'protectedOffline' ? 'tono-home__primary' : 'tono-home__quiet'}`}
            disabled={state === 'disconnecting'}
            onClick={() => onPrimary(failed)}
          >
            <TextSwap text={action} />
          </button>
          {state === 'protectedOffline' ? (
            <button
              type="button"
              className="tono-home__pill tono-home__quiet"
              onClick={onRestore}
            >
              {t('tono.progress.restore')}
            </button>
          ) : null}
          {lineChip}
        </div>
        {state === 'connecting' && elapsed >= HOME_CONNECT_TIMES.switchLine && (
          <p className="tono-home__slow" role="status">
            {t('tono.home.slow.elapsed', {
              seconds: Math.floor(elapsed / 1000),
            })}{' '}
            <button
              type="button"
              className="tono-home__link"
              onClick={() => setLinesOpen(true)}
            >
              {t('tono.home.slow.switch')}
            </button>
          </p>
        )}
        {protectedNow && firstVisit && (
          <p className="tono-home__first">{t('tono.home.firstRun')}</p>
        )}
        <div
          ref={attentionRef}
          className="tono-home__attention"
          style={{ minHeight: 0, overflowY: 'auto' }}
        >
          {attention}
        </div>
      </div>
      <div
        className="tono-home__telemetry"
        inert={sheetOpen || linesOpen}
        style={{
          position: 'absolute',
          left: 56,
          right: 56,
          bottom: 26,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'end',
          gap: 12,
        }}
      >
        <span>
          {protectedNow ? (
            <>
              {traffic}
              {aiTotal !== null && (
                <> · {t('tono.home.telemetry.aiToday', { total: aiTotal })}</>
              )}
            </>
          ) : (
            ''
          )}
        </span>
        <button
          ref={detailsTriggerRef}
          type="button"
          className="tono-home__link"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => {
            closeLines()
            setSheetOpen(true)
          }}
        >
          {t('tono.home.details')} <span aria-hidden="true">⌃</span>
        </button>
      </div>
      {sheetOpen && (
        <div
          className="tono-home__dismiss"
          onPointerDown={closeSheet}
          aria-hidden="true"
        />
      )}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={sheetOpen ? 'true' : undefined}
        aria-label={t('tono.home.details')}
        aria-hidden={!sheetOpen}
        inert={!sheetOpen}
        tabIndex={-1}
        className="tono-home__sheet tono-home__panel"
        data-open={sheetOpen}
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          bottom: 22,
          maxHeight: sheetHeight,
          overflowY: 'auto',
        }}
      >
        <div className="tono-home__sheet-header">
          <h2>{t('tono.home.details')}</h2>
          <button
            type="button"
            className="tono-home__link"
            onClick={closeSheet}
            aria-label={t('tono.home.closeDetails')}
          >
            ⌄
          </button>
        </div>
        <div className="tono-home__tiles">{details}</div>
      </div>
      {linesOpen && (
        <HomeLines
          open={linesOpen}
          anchor={chipRef}
          root={rootRef}
          close={closeLines}
          status={status}
          refreshStatus={refreshStatus}
        />
      )}
      {releaseDialog}
    </div>
  )
}
