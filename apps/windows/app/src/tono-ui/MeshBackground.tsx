import { glassOpacity, useGlassTransparency } from './theme'

/**
 * The frosted-glass window background (MeshGradientBackground.swift): a soft
 * ambient gradient sheet under a near-opaque wash whose alpha follows the
 * Appearance slider. The gradients are already soft, so the previous full-window
 * 40px backdrop blur only forced continuous WebView2 GPU composition.
 */

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
          background: 'var(--tono-mesh)',
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
