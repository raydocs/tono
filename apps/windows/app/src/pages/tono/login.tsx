import { useLockFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  tonoAccountQueryKey,
  tonoDevicesQueryKey,
  tonoServersQueryKey,
  useTonoStatus,
} from '@/hooks/use-tono'
import { removeCacheData } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  stableTonoErrorCode,
  tonoDisconnect,
  tonoRetryRestore,
  tonoSignInStart,
  tonoSignInVerify,
  tonoSignOut,
} from '@/services/tono'
import { useAppearancePreferences } from '@/tono-ui/appearance-preferences'
import { GlassCard } from '@/tono-ui/GlassCard'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'
import { SeaScene } from '@/tono-ui/SeaScene'
import { SupportContact } from '@/tono-ui/SupportContact'
import {
  TONO_COLORS,
  TONO_MONO_STACK,
  TONO_PAGE_LAYOUT,
  tonoText,
} from '@/tono-ui/theme'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import { TonoLogo } from '@/tono-ui/TonoLogo'
import { WelcomeHeroTile } from '@/tono-ui/WelcomeHeroTile'

import './sea-welcome.css'

const RESEND_COUNTDOWN = 60
const SENT_ACK_MS = 1500

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The code in pasted text: six digits standing alone, so a date or year in the same
 * message is not read as the code; otherwise its digits when there are at most six.
 */
const pastedCode = (text: string) => {
  const alone = text.match(/(?<!\d)\d{6}(?!\d)/)
  if (alone) return alone[0]
  const digits = text.replace(/\D/g, '')
  return digits.length <= 6 ? digits : ''
}

const AUTH_ERROR_CODES = new Set([
  'TONO_AUTH_UNREACHABLE',
  'TONO_AUTH_DNS',
  'TONO_AUTH_TCP',
  'TONO_AUTH_TLS',
  'TONO_AUTH_QUIC',
  'TONO_AUTH_TIMEOUT',
  'TONO_AUTH_CAPTIVE',
  'TONO_AUTH_API',
  'TONO_AUTH_LOCAL_CONFLICT',
  'TONO_AUTH_FORBIDDEN',
  'TONO_AUTH_STORE',
  'TONO_AUTH_RATE_LIMITED',
  'TONO_AUTH_DEVICE_LIMIT',
  'TONO_AUTH_UNAUTHORIZED',
  'TONO_AUTH_INVALID_CODE',
  'TONO_SIGN_IN_NOT_SAVED',
  'TONO_CLOCK_SKEW',
  'TONO_TLS_INTERCEPTED',
])

// Copy-to-support gets only fixed labels and allowlisted tokens, never the
// backend error chain (which may contain request URLs or other private data).
const authSupportSummary = (
  stage: 'send-code' | 'verify-code',
  error: unknown,
) => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const foundCode = stableTonoErrorCode(raw)
  const code =
    foundCode && AUTH_ERROR_CODES.has(foundCode) ? foundCode : '(none)'
  const lines = [`Auth stage: ${stage}`, `Error code: ${code}`]
  const transport = raw.match(
    /^TONO_(?:AUTH_[A-Z0-9_]+|CLOCK_SKEW|TLS_INTERCEPTED): could not reach Tono: (?:TONO_CAPTIVE_PORTAL: )?([\s\S]*)$/,
  )?.[1]
  if (transport) {
    const pinned = transport.match(
      /^pinned\[(?:TONO_(?:CLOCK_SKEW|TLS_INTERCEPTED): )?(dns|connect|tls|timeout|other): /,
    )?.[1]
    const resolved = transport.match(
      /\]; system-dns\[(?:TONO_(?:CLOCK_SKEW|TLS_INTERCEPTED): )?(dns|connect|tls|timeout|other): /,
    )?.[1]
    const relay = transport.match(
      /\]; relay\[[^\]]*?: (?:TONO_(?:CLOCK_SKEW|TLS_INTERCEPTED): )?(dns|connect|tls|timeout|other): /,
    )?.[1]
    const direct = transport.match(
      /^(?:TONO_(?:CLOCK_SKEW|TLS_INTERCEPTED): )?(dns|connect|tls|timeout|other): /,
    )?.[1]
    if (pinned) {
      lines.push(
        `Transport: pinned=${pinned}${resolved ? `, system-dns=${resolved}` : ''}${relay ? `, relay=${relay}` : ''}`,
      )
    } else if (direct) {
      lines.push(`Transport: ${direct}`)
    }
  }
  return lines.join('\n')
}

const LoginPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { newAppearance } = useAppearancePreferences()
  const [rejectedAttempt, setRejectedAttempt] = useState(0)
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sentAck, setSentAck] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [restoringInternet, setRestoringInternet] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [verifySuspended, setVerifySuspended] = useState(false)
  const [suspendedDismissed, setSuspendedDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authFailureSummary, setAuthFailureSummary] = useState<string | null>(
    null,
  )
  const [restoreInternetError, setRestoreInternetError] = useState<
    string | null
  >(null)
  const [countdown, setCountdown] = useState(0)
  const autoSubmittedCodeRef = useRef<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const authRequestPendingRef = useRef(false)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((v) => v - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  // A suspended account signed in on another path still lands here; the banner
  // can be dismissed to try a different email.
  const suspended =
    !suspendedDismissed &&
    (verifySuspended || status?.accountState === 'suspended')
  // Only the sign-in response says the account itself is paused. A session the
  // control plane stopped accepting (revoked device, signed out elsewhere, a
  // lapsed plan) also reads as suspended; signing in again is the way out.
  const sessionEnded = suspended && !verifySuspended
  const suspendedTitle = sessionEnded
    ? t('tono.login.sessionEnded.title')
    : t('tono.login.suspended.title')

  const restoreFailed = status?.accountState === 'error'
  // A tunnel that is still connected carries traffic; the barrier only blocks
  // the internet once the tunnel is gone.
  const internetBlocked =
    status?.uiState !== 'connected' &&
    (status?.protectionBlocked === true || status?.killSwitch?.wanted === true)

  const errorOffersSupport =
    Boolean(error) &&
    error !== t('tono.login.invalidEmail') &&
    error !== t('tono.login.invalidCode')
  // `auth/email/start` answers 202 for every address and a failed delivery is
  // silent, so a code that has not arrived by the time resend opens (60 s) gets
  // its own way to support (#596). An error already carrying support wins.
  const showNoEmailHint =
    codeSent && countdown === 0 && !sending && !errorOffersSupport

  const resetToStart = () => {
    setCodeSent(false)
    setSentAck(false)
    setCode('')
    setError(null)
    setAuthFailureSummary(null)
    setRejectedAttempt(0)
    autoSubmittedCodeRef.current = null
  }

  const handleSendCode = useLockFn(async () => {
    if (authRequestPendingRef.current) return
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(t('tono.login.invalidEmail'))
      setAuthFailureSummary(null)
      return
    }
    authRequestPendingRef.current = true
    setEmail(trimmed)
    setSending(true)
    setError(null)
    setAuthFailureSummary(null)
    setSuspendedDismissed(false)
    setVerifySuspended(false)
    try {
      await tonoSignInStart(trimmed)
      setSentAck(true)
      // The challenge's `expiresIn` is the code's validity window (minutes),
      // not a resend cooldown — the resend cooldown stays a fixed 60s.
      setCountdown(RESEND_COUNTDOWN)
    } catch (error) {
      setError(formatTonoActionError(error, t))
      setAuthFailureSummary(authSupportSummary('send-code', error))
    } finally {
      authRequestPendingRef.current = false
      setSending(false)
    }
  })

  const handleVerify = useLockFn(async () => {
    if (authRequestPendingRef.current) return
    const trimmedCode = code.trim()
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError(t('tono.login.invalidCode'))
      setAuthFailureSummary(null)
      return
    }
    authRequestPendingRef.current = true
    setVerifying(true)
    setError(null)
    setAuthFailureSummary(null)
    try {
      const account = await tonoSignInVerify(email.trim(), trimmedCode)
      if (account.suspended) {
        setVerifySuspended(true)
        return
      }
      await mutateTonoStatus()
      navigate('/', { replace: true })
    } catch (error) {
      // The server already used up this code; clear it so a new one is requested.
      if (String(error).includes('TONO_SIGN_IN_NOT_SAVED')) setCode('')
      if (
        newAppearance &&
        stableTonoErrorCode(String(error)) === 'TONO_AUTH_INVALID_CODE'
      ) {
        setCode('')
        autoSubmittedCodeRef.current = null
        setRejectedAttempt((attempt) => attempt + 1)
      }
      setError(formatTonoActionError(error, t))
      setAuthFailureSummary(authSupportSummary('verify-code', error))
    } finally {
      authRequestPendingRef.current = false
      setVerifying(false)
    }
  })

  useEffect(() => {
    if (!sentAck) return
    const timer = window.setTimeout(() => {
      setSentAck(false)
      setCodeSent(true)
    }, SENT_ACK_MS)
    return () => window.clearTimeout(timer)
  }, [sentAck])

  useEffect(() => {
    if (!codeSent || sending || verifying) return
    codeInputRef.current?.focus()
  }, [codeSent, sending, verifying])

  useEffect(() => {
    if (codeSent) return
    emailInputRef.current?.focus()
  }, [codeSent])

  useEffect(() => {
    if (!codeSent || verifying || internetBlocked) return
    if (!/^\d{6}$/.test(code) || autoSubmittedCodeRef.current === code) return
    autoSubmittedCodeRef.current = code
    void handleVerify()
  }, [code, codeSent, handleVerify, internetBlocked, verifying])

  const handleRetryRestore = useLockFn(async () => {
    setRetrying(true)
    setError(null)
    setAuthFailureSummary(null)
    try {
      await tonoRetryRestore()
      await mutateTonoStatus()
    } catch (error) {
      setError(formatTonoActionError(error, t))
    } finally {
      setRetrying(false)
    }
  })

  const handleRestoreInternet = useLockFn(async () => {
    setRestoringInternet(true)
    setRestoreInternetError(null)
    try {
      // This explicit owner-gated release is intentionally available before
      // authentication. A persisted fail-closed Service state can otherwise
      // block the login API while the auth guard hides the dashboard escape.
      await tonoDisconnect()
      await mutateTonoStatus()
      setError(null)
      setAuthFailureSummary(null)
    } catch (error) {
      setRestoreInternetError(formatTonoActionError(error, t))
    } finally {
      setRestoringInternet(false)
    }
  })

  // A paused account is sent no sign-in code, so "Use another email" cannot
  // replace a session the control plane refuses; signing out is the way off
  // this screen. As on the Account page, it releases protection first and
  // keeps the account when that release cannot be proven.
  const handleSignOut = useLockFn(async () => {
    setSigningOut(true)
    setSignOutError(null)
    try {
      await tonoSignOut()
    } catch (error) {
      setSignOutError(formatTonoActionError(error, t))
      return
    } finally {
      setSigningOut(false)
    }
    removeCacheData(tonoAccountQueryKey)
    removeCacheData(tonoDevicesQueryKey)
    removeCacheData(tonoServersQueryKey)
    setVerifySuspended(false)
    setSuspendedDismissed(false)
    resetToStart()
    await mutateTonoStatus()
  })

  const inputStyle: React.CSSProperties = {
    background: 'var(--tono-surface-input)',
    border: '1px solid var(--tono-surface-input-border)',
    color: text.primary,
  }

  const primaryButtonStyle: React.CSSProperties = {
    width: newAppearance && !codeSent ? 'auto' : '100%',
    padding: newAppearance ? '12px 20px' : '12px 16px',
    fontSize: 14,
    color: newAppearance ? '#1A0F0A' : '#fff',
    background: newAppearance
      ? 'var(--sea-primary)'
      : 'var(--tono-action-fill)',
  }

  // A restore that did not take over the Service's barrier leaves it as it is.
  // A locked barrier that still renders the tunnel permit is the previous
  // session's connection carrying traffic, not a blocked machine.
  const previousTunnelRunning =
    status?.killSwitch?.mode === 'locked' &&
    status.killSwitch.tunnel_permit_rendered === true

  const internetRecovery = internetBlocked ? (
    <div
      role="alert"
      className={newAppearance ? 'sea-attention' : undefined}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 12,
        padding: '12px 14px',
        textAlign: 'left',
        color: text.primary,
        background: `${TONO_COLORS.protectedOffline}1F`,
        border: `1px solid ${TONO_COLORS.protectedOffline}4D`,
      }}
    >
      {/* The card and its sign-in gate follow the fail-closed intent; the
          "still blocked" claim needs the Service's live barrier. */}
      <span style={{ fontSize: 13, fontWeight: 650 }}>
        {previousTunnelRunning
          ? t('tono.login.networkBlocked.stillRunningTitle')
          : hasLiveProtection(status)
            ? t('tono.login.networkBlocked.title')
            : t('tono.pill.title.protectionUnknown')}
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.45, color: text.secondary }}>
        {previousTunnelRunning
          ? t('tono.login.networkBlocked.stillRunningDescription')
          : hasLiveProtection(status)
            ? t('tono.login.networkBlocked.description')
            : t('tono.login.networkBlocked.unverifiedDescription')}
      </span>
      <button
        type="button"
        className="tono-button"
        style={{
          width: '100%',
          padding: '9px 12px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
          background: TONO_COLORS.protectedOffline,
        }}
        onClick={handleRestoreInternet}
        disabled={restoringInternet}
      >
        {restoringInternet
          ? t('tono.login.networkBlocked.restoring')
          : t('tono.login.networkBlocked.restore')}
      </button>
      {restoreInternetError && (
        <>
          <span style={{ fontSize: 12, color: 'var(--tono-text-error)' }}>
            {restoreInternetError}
          </span>
          <SupportContact extra={restoreInternetError} />
        </>
      )}
    </div>
  ) : null

  if (suspended) {
    return (
      <div
        className={
          newAppearance
            ? 'tono-page sea-login sea-login--suspended'
            : 'tono-page'
        }
        style={{
          ...TONO_PAGE_LAYOUT,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {newAppearance && (
          <div className="sea-welcome-scene">
            <SeaScene phase={internetBlocked ? 'failed' : 'idle'} />
          </div>
        )}
        <GlassCard
          className={newAppearance ? 'sea-login-recovery' : undefined}
          style={{
            width: 470,
            maxWidth: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
            padding: 32,
          }}
        >
          {internetRecovery}
          {/* The sea scene behind the card is the brand; the violet mark is legacy. */}
          {!newAppearance && <TonoLogo connected={false} size={56} />}
          <h1 className="tono-page-title" style={{ color: text.primary }}>
            {suspendedTitle}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: text.secondary }}>
            {sessionEnded
              ? t('tono.login.sessionEnded.description')
              : t('tono.login.suspended.description')}
          </p>
          <SupportContact email={email} extra={suspendedTitle} />
          <button
            type="button"
            className={newAppearance ? 'sea-button' : 'tono-link'}
            data-variant={newAppearance ? 'primary' : undefined}
            style={
              newAppearance
                ? { minWidth: 160 }
                : { fontSize: 13, color: TONO_COLORS.accent }
            }
            onClick={() => {
              setSuspendedDismissed(true)
              setVerifySuspended(false)
              resetToStart()
            }}
          >
            {sessionEnded
              ? t('tono.login.sessionEnded.signIn')
              : t('tono.login.changeEmail')}
          </button>

          <button
            type="button"
            className="tono-link"
            style={{ fontSize: 13, color: text.secondary }}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {t('tono.account.signOut')}
          </button>
          {signOutError && (
            <span
              role="alert"
              style={{ fontSize: 12, color: 'var(--tono-text-error)' }}
            >
              {signOutError}
            </span>
          )}
        </GlassCard>
      </div>
    )
  }

  return (
    <div
      className={newAppearance ? 'sea-login' : 'tono-welcome'}
      data-code-step={codeSent}
    >
      {newAppearance && (
        <div className="sea-welcome-scene">
          <SeaScene phase={internetBlocked ? 'failed' : 'idle'} />
        </div>
      )}
      {!newAppearance && (
        <aside className="tono-welcome__story tono-welcome-ground">
          <div className="tono-welcome__hero">
            <div className="tono-welcome__brand">
              <TonoLogo connected={false} size={32} />
              <span>Tono</span>
            </div>
            <div className="tono-welcome__message">
              <span className="tono-welcome__eyebrow">
                {t('tono.login.brandLabel')}
              </span>
              <h2>{t('tono.login.brandTitle')}</h2>
              <p>{t('tono.login.brandDescription')}</p>
            </div>
          </div>
          <WelcomeHeroTile size="small" />
          <p className="tono-welcome__footnote">
            {t('tono.login.brandFootnote')}
          </p>
        </aside>
      )}
      <GlassCard
        className="tono-welcome__form"
        padding={newAppearance ? 0 : 'clamp(24px, 4vw, 48px)'}
        style={
          newAppearance
            ? {
                position: 'relative',
                background: 'none',
                border: 'none',
                boxShadow: 'none',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
              }
            : undefined
        }
      >
        {internetRecovery}
        {restoreFailed && (
          <div
            className={newAppearance ? 'sea-attention' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              ...(newAppearance
                ? { textAlign: 'left' }
                : {
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12,
                    color: 'var(--tono-text-error)',
                    background: `${TONO_COLORS.error}1F`,
                  }),
            }}
          >
            <span>
              <strong>{t('tono.login.restoreFailed.title')}</strong>{' '}
              {t('tono.login.restoreFailed.description')}
            </span>
            {newAppearance ? (
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <SupportContact
                  compact
                  extra={t('tono.login.restoreFailed.title')}
                />
                <button
                  type="button"
                  className="sea-button"
                  data-variant="primary"
                  style={{ minHeight: 32, padding: '6px 14px', fontSize: 12 }}
                  onClick={handleRetryRestore}
                  disabled={retrying}
                >
                  {retrying ? '…' : t('tono.login.restoreFailed.retry')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="tono-button"
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  color: '#fff',
                  background: TONO_COLORS.error,
                  flexShrink: 0,
                }}
                onClick={handleRetryRestore}
                disabled={retrying}
              >
                {retrying ? '…' : t('tono.login.restoreFailed.retry')}
              </button>
            )}
          </div>
        )}
        {restoreFailed && !newAppearance && (
          <SupportContact extra={t('tono.login.restoreFailed.title')} />
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            textAlign: 'left',
          }}
        >
          <span className="tono-welcome__eyebrow">
            {t(codeSent ? 'tono.login.stepCode' : 'tono.login.stepEmail')}
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: newAppearance ? 44 : 28,
              fontWeight: newAppearance ? 300 : 650,
              letterSpacing: -0.4,
              color: text.primary,
            }}
          >
            {t(codeSent ? 'tono.login.checkInbox' : 'tono.login.welcome')}
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 320,
              fontSize: 13,
              lineHeight: 1.55,
              color: text.secondary,
            }}
          >
            {t(codeSent ? 'tono.login.inboxInstructions' : 'tono.login.intro')}
          </p>
        </div>

        <p className="tono-sr-only" role="status">
          {sending
            ? t('tono.login.sending')
            : sentAck
              ? t('tono.login.sent')
              : verifying
                ? t('tono.login.verifying')
                : codeSent
                  ? t('tono.login.codeSent')
                  : ''}
        </p>

        <form
          className={newAppearance ? 'sea-login-fields' : undefined}
          aria-busy={sending || sentAck || verifying}
          onSubmit={(event) => {
            event.preventDefault()
            if (!codeSent) void handleSendCode()
            else void handleVerify()
          }}
          style={{
            display: newAppearance && !codeSent ? 'grid' : 'flex',
            flexDirection: 'column',
            gap: 12,
            width: '100%',
          }}
        >
          <label
            className={newAppearance ? 'sea-email-field' : undefined}
            style={{
              display: newAppearance && codeSent ? 'none' : 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span
              style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}
            >
              {t('tono.login.emailLabel')}
            </span>
            <input
              className="tono-input"
              ref={emailInputRef}
              style={inputStyle}
              type="email"
              required
              aria-invalid={error === t('tono.login.invalidEmail')}
              autoComplete="email"
              placeholder={t('tono.login.emailPlaceholder')}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
                setAuthFailureSummary(null)
              }}
              disabled={
                sending ||
                sentAck ||
                verifying ||
                restoringInternet ||
                internetBlocked ||
                codeSent
              }
            />
          </label>

          {!codeSent ? (
            <>
              <p className="tono-welcome__trust">
                <TonoIcon name="lock" size={14} />
                <span>{t('tono.login.trust')}</span>
              </p>
              <button
                type="submit"
                className={
                  sending
                    ? 'tono-button tono-action tono-progress-pill tono-progress-pill--sending'
                    : 'tono-button tono-action tono-progress-pill'
                }
                style={primaryButtonStyle}
                disabled={
                  sending || sentAck || restoringInternet || internetBlocked
                }
              >
                <span>
                  {sending
                    ? t('tono.login.sending')
                    : sentAck
                      ? t('tono.login.sent')
                      : t('tono.login.sendCode')}
                </span>
              </button>
            </>
          ) : (
            <>
              <label
                className={newAppearance ? 'sea-code-label' : undefined}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: text.secondary,
                  }}
                >
                  {t('tono.login.codeLabel')}
                </span>
                <div
                  className={newAppearance ? 'sea-code-entry' : undefined}
                  data-rejected={newAppearance && rejectedAttempt > 0}
                >
                  {newAppearance && (
                    <div
                      className="sea-code-boxes"
                      key={rejectedAttempt}
                      data-rejected={rejectedAttempt > 0}
                      aria-hidden="true"
                    >
                      {[0, 1, 2, 3, 4, 5].map((position) => (
                        <span
                          key={`digit-${position}`}
                          data-active={Math.min(code.length, 5) === position}
                        >
                          {code[position] ?? ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    className={
                      newAppearance ? 'tono-input sea-code-input' : 'tono-input'
                    }
                    style={{
                      ...inputStyle,
                      textAlign: 'center',
                      letterSpacing: 10,
                      fontSize: 22,
                      fontWeight: 650,
                    }}
                    ref={codeInputRef}
                    placeholder={t('tono.login.codePlaceholder')}
                    value={code}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-describedby="tono-code-help"
                    aria-invalid={Boolean(error)}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    onPaste={
                      newAppearance
                        ? (event) => {
                            event.preventDefault()
                            const pasted = pastedCode(
                              event.clipboardData.getData('text'),
                            )
                            if (pasted) setCode(pasted)
                          }
                        : undefined
                    }
                    disabled={
                      sending ||
                      verifying ||
                      restoringInternet ||
                      internetBlocked
                    }
                  />
                </div>
              </label>
              <button
                type="submit"
                className="tono-button tono-action"
                style={primaryButtonStyle}
                disabled={
                  sending ||
                  verifying ||
                  restoringInternet ||
                  internetBlocked ||
                  !/^\d{6}$/.test(code)
                }
              >
                {verifying ? t('tono.login.verifying') : t('tono.login.verify')}
              </button>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span style={{ color: text.tertiary }}>
                  {t('tono.login.validity')}
                </span>
                <button
                  type="button"
                  className="tono-link"
                  style={{
                    fontSize: 12,
                    color: countdown > 0 ? text.tertiary : TONO_COLORS.accent,
                    cursor: countdown > 0 ? 'default' : 'pointer',
                    flexShrink: 0,
                  }}
                  onClick={countdown > 0 ? undefined : handleSendCode}
                  disabled={
                    sending ||
                    verifying ||
                    restoringInternet ||
                    internetBlocked ||
                    countdown > 0
                  }
                >
                  {countdown > 0
                    ? t('tono.login.resendIn', { seconds: countdown })
                    : t('tono.login.sendNewCode')}
                </button>
              </div>
              <button
                type="button"
                className="tono-link"
                style={{
                  fontSize: 12,
                  color: text.secondary,
                  alignSelf: 'center',
                }}
                onClick={resetToStart}
                disabled={
                  sending || verifying || restoringInternet || internetBlocked
                }
              >
                {t('tono.login.changeEmail')}
              </button>
            </>
          )}
        </form>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 12,
              textAlign: 'center',
              color: 'var(--tono-text-error)',
            }}
          >
            {error}
          </p>
        )}
        {errorOffersSupport && (
          <SupportContact
            email={email}
            extra={authFailureSummary ?? error ?? undefined}
          />
        )}
        {codeSent && (
          <div
            id="tono-code-help"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <code
              style={{
                fontFamily: TONO_MONO_STACK,
                fontSize: 13,
                color: text.primary,
                userSelect: 'text',
              }}
            >
              {email.trim()}
            </code>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                textAlign: 'center',
                color: text.secondary,
              }}
            >
              {t('tono.login.codeSentTo')}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                textAlign: 'center',
                color: text.tertiary,
              }}
            >
              {t('tono.login.codeFrom')}
            </p>
          </div>
        )}
        {showNoEmailHint && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <strong style={{ fontSize: 12, color: text.primary }}>
              {t('tono.login.noEmail.title')}
            </strong>
            <span
              style={{ fontSize: 12, lineHeight: 1.45, color: text.secondary }}
            >
              {t('tono.login.noEmail.description')}
            </span>
            <SupportContact
              email={email}
              extra={t('tono.login.noEmail.title')}
            />
          </div>
        )}
      </GlassCard>
    </div>
  )
}

export default LoginPage
