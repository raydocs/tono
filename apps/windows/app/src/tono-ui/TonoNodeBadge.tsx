import { useId } from 'react'

import { useThemeMode } from '@/services/states'

import { TONO_COLORS } from './theme'

type TonoNodeBadgeProps = {
  /** Pixel size; the mark is square. */
  size?: number
}

/**
 * The node identity mark: a neutral glass tile carrying the Tono route glyph
 * — a source node fanning out to two exits, stroked with the brand gradient
 * (the blue-to-peach sweep of the TO monogram). Identity comes from the brand
 * language, not from flags or per-region color blocks; the tile stays neutral
 * so it sits quietly in both light and dark mode. Same glyph as the macOS
 * `NodeRouteMark` shape.
 */
export const TonoNodeBadge = ({ size = 44 }: TonoNodeBadgeProps) => {
  const dark = useThemeMode() !== 'light'
  const gradientId = useId()

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.28),
        background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(56,72,108,0.055)',
        border: `1px solid ${dark ? 'rgba(255,255,255,0.13)' : 'rgba(56,72,108,0.10)'}`,
        boxSizing: 'border-box',
      }}
    >
      <svg
        width={Math.round(size * 0.48)}
        height={Math.round(size * 0.48)}
        viewBox="0 0 24 24"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <title>Tono route</title>
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
            gradientUnits="objectBoundingBox"
          >
            <stop offset="0" stopColor={TONO_COLORS.accent} />
            <stop offset="0.52" stopColor={TONO_COLORS.accentSoft} />
            <stop offset="1" stopColor={TONO_COLORS.accentWarm} />
          </linearGradient>
        </defs>
        <circle cx="12" cy="5" r="2.1" />
        <circle cx="6" cy="18" r="2.1" />
        <circle cx="18" cy="18" r="2.1" />
        <path d="m10.7 6.6-3.5 9.3m6.1-9.3 3.5 9.3M8.1 18h7.8" />
      </svg>
    </span>
  )
}
