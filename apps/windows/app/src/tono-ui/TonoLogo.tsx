import brandIcon from '@/assets/image/logo-mask.png'

/**
 * The shared Tono product mark used by the Windows shell and primary action.
 * The asset supplies its own transparent safety margin; do not add a tile,
 * rounded frame, border, or drop shadow around it.
 */

interface TonoLogoProps {
  connected: boolean
  /** Pixel size; the mark is square. */
  size?: number
  /** Sidebar/inline variant: smaller neutral shadow and no state animation. */
  compact?: boolean
}

export const TonoLogo = ({ size = 52 }: TonoLogoProps) => {
  return (
    <img
      src={brandIcon}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      style={{
        display: 'block',
        width: size,
        height: size,
        objectFit: 'contain',
      }}
    />
  )
}
