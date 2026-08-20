import markOptical from '@/assets/image/tono-mark-16-color.svg?url'
import markFull from '@/assets/image/tono-mark.svg?url'

/**
 * The shared Tono product mark. Full mark at ≥28px; below that the concentric
 * counter collapses on the pixel grid, so the optical variant is used.
 *
 * These SVGs are a faithful reconstruction from the bitmap master, not a
 * brand-signed vector. Tray/taskbar `.ico` files stay on the raster pipeline
 * until design signs the traces off.
 */

interface TonoLogoProps {
  connected: boolean
  /** Pixel size; the mark is square. */
  size?: number
  /** Sidebar/inline variant: smaller neutral shadow and no state animation. */
  compact?: boolean
}

export const TonoLogo = ({ size = 52 }: TonoLogoProps) => {
  const src = size < 28 ? markOptical : markFull
  return (
    <img
      src={src}
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
