import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useThemeMode } from '@/services/states'

import { TONO_COLORS, tonoText } from './theme'
import { TonoToastContext } from './tono-toast-context'

/**
 * App-wide transient confirmations ("Switched to …"), the Windows twin of the
 * macOS ToastCenter/TonoToastHost. One toast at a time — a new one replaces
 * the current and resets its timers. UI-layer only: pages call the hook, no
 * service layer is touched. Enter/exit run on CSS transitions, which the
 * global prefers-reduced-motion block in tono.css flattens automatically.
 */

const SHOW_MS = 2500
const EXIT_MS = 200

type TonoToast = { id: number; message: string; leaving: boolean }

const CheckIcon = () => (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>Done</title>
    <circle cx="12" cy="12" r="9" opacity="0.45" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
  </svg>
)

export const TonoToastProvider = ({ children }: { children: ReactNode }) => {
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)
  const [toast, setToast] = useState<TonoToast | null>(null)
  const idRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer)
    },
    [],
  )

  const show = useCallback((message: string) => {
    for (const timer of timersRef.current) clearTimeout(timer)
    timersRef.current = []
    idRef.current += 1
    const id = idRef.current
    setToast({ id, message, leaving: false })
    timersRef.current.push(
      setTimeout(() => {
        setToast((current) =>
          current?.id === id ? { ...current, leaving: true } : current,
        )
      }, SHOW_MS),
      setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current))
      }, SHOW_MS + EXIT_MS),
    )
  }, [])

  const contextValue = useMemo(() => show, [show])

  return (
    <TonoToastContext value={contextValue}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`tono-toast${toast.leaving ? ' tono-toast--leaving' : ''}`}
          style={{
            position: 'fixed',
            top: 14,
            left: '50%',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 'min(480px, calc(100vw - 48px))',
            padding: '10px 16px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: text.primary,
            background: dark ? 'rgba(16,21,33,0.85)' : 'rgba(255,255,255,0.85)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(56,72,108,0.12)'}`,
            boxShadow: dark
              ? '0 16px 36px -20px rgba(0,0,0,0.8)'
              : '0 16px 36px -20px rgba(55,72,110,0.4)',
            backdropFilter: 'var(--tono-glass-blur)',
            WebkitBackdropFilter: 'var(--tono-glass-blur)',
          }}
        >
          <span
            aria-hidden
            style={{
              color: TONO_COLORS.accent,
              flexShrink: 0,
              display: 'flex',
            }}
          >
            <CheckIcon />
          </span>
          {toast.message}
        </div>
      )}
    </TonoToastContext>
  )
}
