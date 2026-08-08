import { glassOpacity, useGlassTransparency } from './theme'

/**
 * The frosted-glass window background (MeshGradientBackground.swift): a soft
 * ambient gradient sheet under a near-opaque wash whose alpha follows the
 * Appearance slider. The gradients are already soft, so the previous full-window
 * 40px backdrop blur only forced continuous WebView2 GPU composition.
 */

// Soft mesh aligned with the TO brand gradient: blue → violet → warm peach.
const LIGHT_MESH = [
  'radial-gradient(52% 64% at 16% 10%, rgba(176, 196, 255, 0.78) 0%, rgba(176, 196, 255, 0) 100%)',
  'radial-gradient(46% 56% at 84% 12%, rgba(198, 184, 255, 0.55) 0%, rgba(198, 184, 255, 0) 100%)',
  'radial-gradient(58% 64% at 78% 90%, rgba(255, 196, 168, 0.42) 0%, rgba(255, 196, 168, 0) 100%)',
  'radial-gradient(54% 58% at 12% 88%, rgba(188, 210, 235, 0.55) 0%, rgba(188, 210, 235, 0) 100%)',
  'linear-gradient(160deg, #f3f5fb 0%, #eceff7 100%)',
].join(', ')

const DARK_MESH = [
  'radial-gradient(52% 64% at 16% 10%, rgba(46, 64, 128, 0.62) 0%, rgba(46, 64, 128, 0) 100%)',
  'radial-gradient(46% 56% at 84% 12%, rgba(72, 52, 120, 0.45) 0%, rgba(72, 52, 120, 0) 100%)',
  'radial-gradient(58% 64% at 78% 90%, rgba(96, 52, 48, 0.28) 0%, rgba(96, 52, 48, 0) 100%)',
  'radial-gradient(54% 58% at 12% 88%, rgba(24, 38, 72, 0.55) 0%, rgba(24, 38, 72, 0) 100%)',
  'linear-gradient(160deg, #0b0e18 0%, #090b12 100%)',
].join(', ')

export const MeshBackground = ({ dark }: { dark: boolean }) => {
  const transparency = useGlassTransparency()
  const opacity = glassOpacity(transparency)

  return (
    <div
      aria-hidden
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: dark ? DARK_MESH : LIGHT_MESH,
        }}
      />
      <div
        className="tono-mesh-wash"
        style={{
          position: 'absolute',
          inset: 0,
          background: dark
            ? `rgba(9, 11, 18, ${opacity})`
            : `rgba(243, 245, 250, ${opacity})`,
          transition: 'background 0.2s ease',
        }}
      />
    </div>
  )
}
