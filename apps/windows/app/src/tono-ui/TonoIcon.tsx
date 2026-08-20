import type { CSSProperties } from 'react'

/**
 * The single Tono icon set. One geometry (24 grid), one weight (1.75), round
 * caps and joins. Brand marks (TO monogram, node route mark) stay as assets.
 */
const PATHS = {
  dashboard: [
    'M3.5 3.5h7.2v6.6H3.5z',
    'M13.3 3.5h7.2v4.2h-7.2z',
    'M13.3 10.3h7.2v10.2h-7.2z',
    'M3.5 12.7h7.2v7.8H3.5z',
  ],
  activity: ['M3.5 20.5V3.5', 'M3.5 20.5h17', 'm6.5 16 4-5.5 3.5 3 5-7'],
  nodes: [
    'M6.6 18.8h10.8a3.9 3.9 0 0 0 .2-7.8 5.8 5.8 0 0 0-11.2-.6 3.6 3.6 0 0 0 .2 8.4z',
  ],
  account: [
    'M12 11.8a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z',
    'M4.8 20.2a7.2 7.2 0 0 1 14.4 0',
  ],
  support: [
    'M4.2 13.2a7.8 7.8 0 0 1 15.6 0',
    'M4.2 13.2v2.6a2.2 2.2 0 0 0 2.2 2.2h.9v-5.2h-.9a2.2 2.2 0 0 0-2.2 2.2z',
    'M19.8 13.2v2.6a2.2 2.2 0 0 1-2.2 2.2h-.9v-5.2h.9a2.2 2.2 0 0 1 2.2 2.2z',
    'M11.6 20.6h3.1a2.2 2.2 0 0 0 2.1-2.6',
  ],
  settings: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z',
  ],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4.2-4.2'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  copy: ['M9 9h9.5v11H9z', 'M15 6H5.5v11H7'],
  chevronRight: ['m10 8 4.5 4-4.5 4'],
  chevronDown: ['m8 10.5 4 4.5 4-4.5'],
  check: ['m6.5 12.5 3.5 3.5 7.5-8.5'],
  checkCircle: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'm8.5 12.5 2.5 2.5 4.5-5.5',
  ],
  bolt: ['M13.6 3.2 6.4 12.9h4.6l-1 7.9 7.6-10.1h-4.7z'],
  globe: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M2 12h20',
    'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  ],
  lock: [
    'M6.2 10.6h11.6v9.8H6.2z',
    'M9 10.6V8.1a3 3 0 0 1 6 0v2.5',
    'M12 14.4v2.4',
  ],
  refresh: ['M20 12a8 8 0 1 1-2.9-6.2', 'M20.2 4.4v4.4h-4.4'],
  alert: ['M12 4.5 21 20H3z', 'M12 10v4', 'M12 16.6v.2'],
  upload: ['M12 19V4.6', 'm7.2 9.4 4.8-4.8 4.8 4.8', 'M4.8 20.4h14.4'],
  download: ['M12 4.2v14.4', 'm7.2 13.8 4.8 4.8 4.8-4.8', 'M4.8 20.4h14.4'],
  power: ['M12 3v9', 'M6.3 6.6a8 8 0 1 0 11.4 0'],
  shield: [
    'M12 21.2c4.5-1.8 7-5 7-9.2V5.6L12 3 5 5.6v6.4c0 4.2 2.5 7.4 7 9.2z',
  ],
  shieldCheck: [
    'M12 21.2c4.5-1.8 7-5 7-9.2V5.6L12 3 5 5.6v6.4c0 4.2 2.5 7.4 7 9.2z',
    'm8.9 11.8 2.2 2.2 4-4.6',
  ],
} as const

export type TonoIconName = keyof typeof PATHS

export const TonoIcon = ({
  name,
  size = 16,
  strokeWidth = 1.75,
  title,
  style,
  className,
}: {
  name: TonoIconName
  size?: number
  strokeWidth?: number
  title?: string
  style?: CSSProperties
  className?: string
}) => {
  const paths = PATHS[name]
  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <title>{title ?? name}</title>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
