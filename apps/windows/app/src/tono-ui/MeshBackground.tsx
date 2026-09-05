import { glassOpacity, useGlassTransparency } from './theme'

/**
 * Clarity's quiet content ground. The appearance slider changes tint, not
 * backdrop sampling. No mesh, canvas, or continuous compositor work.
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
          background: dark ? '#202b45' : '#e4ebfa',
        }}
      />
      <div
        className="tono-mesh-wash"
        style={{
          position: 'absolute',
          inset: 0,
          background: dark
            ? `rgba(20, 25, 34, ${opacity})`
            : `rgba(246, 248, 252, ${opacity})`,
          transition: 'background 0.2s ease',
        }}
      />
    </div>
  )
}
