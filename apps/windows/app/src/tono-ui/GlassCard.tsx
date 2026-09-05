import type { CSSProperties, ReactNode } from 'react'

/**
 * Shared content surface. Clarity tokens resolve this to an opaque card with
 * a visible border and no backdrop filter. The name and optional tint API
 * remain compatible with existing consumers, including the tray.
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
