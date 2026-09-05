import { useLockFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { useTonoStatus } from '@/hooks/use-tono'
import { useThemeMode } from '@/services/states'
import {
  formatTonoActionError,
  tonoDisconnect,
  tonoRetryRestore,
  tonoSignInStart,
  tonoSignInVerify,
} from '@/services/tono'
import { GlassCard } from '@/tono-ui/GlassCard'
import { SupportContact } from '@/tono-ui/SupportContact'
import {
  TONO_COLORS,
  TONO_MONO_STACK,
  TONO_PAGE_LAYOUT,
  tonoText,
} from '@/tono-ui/theme'
import { TonoLogo } from '@/tono-ui/TonoLogo'

const RESEND_COUNTDOWN = 60

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LoginPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const { status, mutateTonoStatus } = useTonoStatus()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [restoringInternet, setRestoringInternet] = useState(false)
  const [verifySuspended, setVerifySuspended] = useState(false)
  const [suspendedDismissed, setSuspendedDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoreInternetError, setRestoreInternetError] = useState<
    string | null
  >(null)
  const [countdown, setCountdown] = useState(0)
  const [autoSubmittedCode, setAutoSubmittedCode] = useState<string | null>(
    null,
  )
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

  const restoreFailed = status?.accountState === 'error'
  const internetBlocked =
    status?.protectionBlocked === true || status?.killSwitch?.wanted === true

  const resetToStart = () => {
    setCodeSent(false)
    setCode('')
    setError(null)
    setAutoSubmittedCode(null)
  }

  const handleSendCode = useLockFn(async () => {
    if (authRequestPendingRef.current) return
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(t('tono.login.invalidEmail'))
      return
    }
    authRequestPendingRef.current = true
    setEmail(trimmed)
    setSending(true)
    setError(null)
    try {
      await tonoSignInStart(trimmed)
      setCodeSent(true)
      // The challenge's `expiresIn` is the code's validity window (minutes),
      // not a resend cooldown — the resend cooldown stays a fixed 60s.
      setCountdown(RESEND_COUNTDOWN)
    } catch (error) {
      setError(formatTonoActionError(error, t))
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
      return
    }
    authRequestPendingRef.current = true
    setVerifying(true)
    setError(null)
    try {
      const account = await tonoSignInVerify(email.trim(), trimmedCode)
      if (account.suspended) {
        setVerifySuspended(true)
        return
      }
      await mutateTonoStatus()
      navigate('/', { replace: true })
    } catch (error) {
      setError(formatTonoActionError(error, t))
    } finally {
      authRequestPendingRef.current = false
      setVerifying(false)
    }
  })

  useEffect(() => {
    if (!codeSent) return
    codeInputRef.current?.focus()
  }, [codeSent])

  useEffect(() => {
    if (codeSent) return
    emailInputRef.current?.focus()
  }, [codeSent])

  useEffect(() => {
    if (!codeSent || verifying || internetBlocked) return
    if (!/^\d{6}$/.test(code) || autoSubmittedCode === code) return
    setAutoSubmittedCode(code)
    void handleVerify()
  }, [
    autoSubmittedCode,
    code,
    codeSent,
    handleVerify,
    internetBlocked,
    verifying,
  ])

  const handleRetryRestore = useLockFn(async () => {
    setRetrying(true)
    setError(null)
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
    } catch (error) {
      setRestoreInternetError(formatTonoActionError(error, t))
    } finally {
      setRestoringInternet(false)
    }
  })

  const inputStyle: React.CSSProperties = {
    background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(20,22,30,0.12)'}`,
    color: text.primary,
  }

  const primaryButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    fontSize: 14,
    color: '#fff',
    background: TONO_COLORS.accent,
  }

  const internetRecovery = internetBlocked ? (
    <div
      role="alert"
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
      <span style={{ fontSize: 13, fontWeight: 650 }}>
        {t('tono.login.networkBlocked.title')}
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.45, color: text.secondary }}>
        {t('tono.login.networkBlocked.description')}
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
          <span style={{ fontSize: 12, color: TONO_COLORS.error }}>
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
        className="tono-page"
        style={{
          ...TONO_PAGE_LAYOUT,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <GlassCard
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
          <TonoLogo connected={false} size={56} />
          <h1 className="tono-page-title" style={{ color: text.primary }}>
            {t('tono.login.suspended.title')}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: text.secondary }}>
            {t('tono.login.suspended.description')}
          </p>
          <SupportContact
            email={email}
            extra={t('tono.login.suspended.title')}
          />
          <button
            type="button"
            className="tono-link"
            style={{ fontSize: 13, color: TONO_COLORS.accent }}
            onClick={() => {
              setSuspendedDismissed(true)
              setVerifySuspended(false)
              resetToStart()
            }}
          >
            {t('tono.login.changeEmail')}
          </button>
        </GlassCard>
      </div>
    )
  }

  return (
    <div
      className="tono-page"
      style={{
        ...TONO_PAGE_LAYOUT,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <GlassCard
        style={{
          width: 470,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 18,
          padding: 32,
        }}
      >
        {internetRecovery}
        {restoreFailed && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12,
              color: TONO_COLORS.error,
              background: `${TONO_COLORS.error}1F`,
            }}
          >
            <span>
              <strong>{t('tono.login.restoreFailed.title')}</strong>{' '}
              {t('tono.login.restoreFailed.description')}
            </span>
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
          </div>
        )}
        {restoreFailed && (
          <SupportContact extra={t('tono.login.restoreFailed.title')} />
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            textAlign: 'center',
          }}
        >
          <TonoLogo connected={false} size={56} />
          <h1
            style={{
              margin: '8px 0 0',
              fontSize: 22,
              fontWeight: 650,
              letterSpacing: -0.4,
              color: text.primary,
            }}
          >
            {t('tono.login.welcome')}
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
            {t('tono.login.intro')}
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!codeSent) void handleSendCode()
            else void handleVerify()
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: '100%',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              autoComplete="email"
              placeholder={t('tono.login.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={
                sending ||
                verifying ||
                restoringInternet ||
                internetBlocked ||
                codeSent
              }
            />
          </label>

          {!codeSent ? (
            <button
              type="submit"
              className="tono-button"
              style={primaryButtonStyle}
              disabled={sending || restoringInternet || internetBlocked}
            >
              {sending ? t('tono.login.sending') : t('tono.login.sendCode')}
            </button>
          ) : (
            <>
              <label
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
                <input
                  className="tono-input"
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
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  disabled={
                    sending || verifying || restoringInternet || internetBlocked
                  }
                />
              </label>
              <button
                type="submit"
                className="tono-button"
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
              color: TONO_COLORS.error,
            }}
          >
            {error}
          </p>
        )}
        {error &&
          error !== t('tono.login.invalidEmail') &&
          error !== t('tono.login.invalidCode') && (
            <SupportContact email={email} extra={error} />
          )}
        {codeSent && !error && (
          <div
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
                color: TONO_COLORS.latencyGood,
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
      </GlassCard>
    </div>
  )
}

export default LoginPage
