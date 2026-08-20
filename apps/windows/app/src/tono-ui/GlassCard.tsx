import type { CSSProperties, ReactNode } from 'react'

/**
 * The Tono glass card: white-tinted background at the stepped opacities the
 * macOS design uses (4/6/8/12/24/40%), a 1px white border, rounded corners,
 * and a blurred backdrop. Defaults match the settings cards (light 40% /
 * dark 8%, radius 24); dashboard cards pass their own step.
 */

interface GlassCardProps {
  children: ReactNode
  radius?: number | string
  /** CSS background for the tint; defaults to the settings-card step. */
  tint?: string
  border?: boolean
  padding?: CSSProperties['padding']
  style?: CSSProperties
  className?: string
}

export const GlassCard = ({
  children,
  radius = 'var(--tono-radius-card-lg)',
  tint,
  border = true,
  padding = 24,
  style,
  className,
}: GlassCardProps) => {
  return (
    <div
      className={['tono-glass-card', className].filter(Boolean).join(' ')}
      style={{
        borderRadius: radius,
        padding,
        background: tint ?? 'var(--tono-surface-card)',
        border: border ? '1px solid var(--tono-surface-card-border)' : 'none',
        boxShadow: 'var(--tono-shadow-card)',
        backdropFilter: 'var(--tono-glass-blur)',
        WebkitBackdropFilter: 'var(--tono-glass-blur)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
