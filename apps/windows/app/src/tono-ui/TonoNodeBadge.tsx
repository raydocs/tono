import { useId } from 'react'

import { useThemeMode } from '@/services/states'

import { TONO_COLORS } from './theme'

type TonoNodeBadgeProps = {
  /** Pixel size; the mark is square. */
  size?: number
  /** City name from the catalog display title; picks a landmark stroke. */
  city?: string | null
}

/**
 * The node identity mark: a neutral glass tile carrying the Tono route glyph
 * — a source node fanning out to two exits, stroked with the brand gradient
 * (the blue-to-peach sweep of the TO monogram). Identity comes from the brand
 * language, not from flags or per-region color blocks; the tile stays neutral
 * so it sits quietly in both light and dark mode. Same glyph as the macOS
 * `NodeRouteMark` shape.
 */
const cityGlyph = (city?: string | null) => {
  switch ((city ?? '').trim().toLowerCase()) {
    case 'los angeles':
    case 'san jose':
    case 'miami':
      return (
        <>
          <path d="M12 21C12.5 18 12.5 14 12 11" />
          <path d="M12 11C10.2 10.6 7.4 11.2 5.6 12.6" />
          <path d="M12 11C13.8 10.6 16.6 11.2 18.4 12.6" />
          <path d="M12 11C10.4 9.4 8.2 7.8 5.8 7.2" />
          <path d="M12 11C13.6 9.4 15.8 7.8 18.2 7.2" />
          <path d="M12 11C11.2 8.8 10.4 6.4 9.4 4.6" />
          <path d="M12 11C12.8 8.8 13.6 6.4 14.6 4.6" />
          <path d="M8.5 21h7" />
        </>
      )
    case 'tokyo':
      return (
        <>
          <path d="M4 6.5C6.6 5.5 17.4 5.5 20 6.5" />
          <path d="M6 6.2V5.4M18 6.2V5.4" />
          <path d="M5.5 10h13" />
          <path d="M7 6.5 6.5 20M17 6.5 17.5 20" />
          <path d="M12 6.5V10" />
        </>
      )
    case 'osaka':
      return (
        <>
          <path d="M9.5 20v-3.2h5V20" />
          <path d="M7 16.8C8.4 15.8 15.6 15.8 17 16.8" />
          <path d="M8.6 13.4h6.8l1.2 2H7.4z" />
          <path d="M9.4 10.2h5.2l1 1.8H8.4z" />
          <path d="M10.4 7.4h3.2l.9 1.6H9.5z" />
          <path d="M12 7.4V5.2l1.3-.7" />
          <path d="M5.5 20h13" />
        </>
      )
    case 'salt lake city':
      return (
        <>
          <path d="M3.5 16 9 7l3.2 5.2" />
          <path d="m10.8 14.5 4.2-9 5.5 10.5" />
          <path d="m13.7 8.4 1.3 1.2 1.3-1.2" />
          <path d="M4.5 18.5C7 17.8 9.5 19.2 12 18.5" />
          <path d="M13.5 18.5C15.5 19.2 17.5 17.8 19.5 18.5" />
        </>
      )
    case 'buffalo':
      return (
        <>
          <path d="M3.5 7.5C5.5 7.1 8 7.9 10 7.5" />
          <path d="M10 7.5C12.5 7.2 15.5 7.4 17.5 8.2" />
          <path d="M11 7.9v8.6M13.5 7.8v9.4M16 8v8.5" />
          <path d="M7.5 18.8C9 17.8 10.5 19.6 12 18.8C13.5 17.9 15 19.6 16.5 18.8" />
        </>
      )
    default:
      return (
        <>
          <circle cx="12" cy="5" r="2.1" />
          <circle cx="6" cy="18" r="2.1" />
          <circle cx="18" cy="18" r="2.1" />
          <path d="m10.7 6.6-3.5 9.3m6.1-9.3 3.5 9.3M8.1 18h7.8" />
        </>
      )
  }
}

export const TonoNodeBadge = ({ size = 44, city }: TonoNodeBadgeProps) => {
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
        {cityGlyph(city)}
      </svg>
    </span>
  )
}
