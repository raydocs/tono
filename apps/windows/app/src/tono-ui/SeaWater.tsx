import { useLayoutEffect, useRef, type RefObject } from 'react'

import { startSeaWater } from './sea-water-gl'

const supportsSeaWater =
  typeof window !== 'undefined' && 'WebGLRenderingContext' in window

/** Mounted only at full quality; `running` false (page hidden) holds the last
 *  frame, and `throttled` (visible but not in front) draws at about 15 fps. */
export const SeaWaterCanvas = ({
  sceneRef,
  running,
  throttled = false,
}: {
  sceneRef: RefObject<HTMLDivElement | null>
  running: boolean
  throttled?: boolean
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ReturnType<typeof startSeaWater>>(null)
  const motionRef = useRef({ running, throttled })
  motionRef.current = { running, throttled }
  useLayoutEffect(() => {
    const scene = sceneRef.current
    const canvas = canvasRef.current
    if (!scene || !canvas) return
    const renderer = startSeaWater(scene, canvas)
    rendererRef.current = renderer
    if (motionRef.current.running) renderer?.resume(motionRef.current.throttled)
    return () => {
      renderer?.dispose()
      rendererRef.current = null
    }
  }, [sceneRef])
  useLayoutEffect(() => {
    if (running) rendererRef.current?.resume(throttled)
    else rendererRef.current?.pause()
  }, [running, throttled])
  if (!supportsSeaWater) return null
  return (
    <canvas
      ref={canvasRef}
      className="sea-gl"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0,
      }}
    />
  )
}
