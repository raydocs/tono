import type { SceneProbeReport, SceneQuality } from './appearance-preferences'

export const SCENE_PROBE_BUDGET_MS = 3000
const CHECKPOINT_MS = 1500
export const framePercentile95 = (frames: readonly number[]) => {
  const sorted = [...frames].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}
export const readSceneRenderer = () => {
  if (typeof WebGLRenderingContext === 'undefined') return 'Unavailable'
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl')
  if (!gl) return 'Unavailable'
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER))
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/** Collect only visible intervals; no rendering, timers, or unbounded frame work. */
export class SceneQualityProbe {
  quality: SceneQuality
  complete = false
  private last: number | null = null
  private elapsed = 0
  private checkpoint = false
  private readonly frames: number[] = []
  private readonly liteFrames: number[] = []
  constructor(
    quality: SceneQuality,
    private readonly automatic: boolean,
    private readonly renderer: string,
  ) {
    this.quality =
      automatic &&
      /Basic Render|SwiftShader|llvmpipe/i.test(renderer) &&
      quality === 'full'
        ? 'lite'
        : quality
  }
  pause() {
    this.last = null
  }
  frame(now: number) {
    if (this.complete) return
    if (this.last !== null) {
      const interval = now - this.last
      if (interval > 0 && Number.isFinite(interval)) {
        this.elapsed += interval
        this.frames.push(interval)
        if (this.quality === 'lite') this.liteFrames.push(interval)
        if (
          this.automatic &&
          this.elapsed >= CHECKPOINT_MS &&
          !this.checkpoint
        ) {
          this.checkpoint = true
          if (this.quality === 'full' && framePercentile95(this.frames) > 34)
            this.quality = 'lite'
          else if (
            this.quality === 'lite' &&
            framePercentile95(this.liteFrames) > 50
          )
            this.quality = 'static'
        }
        if (this.elapsed >= SCENE_PROBE_BUDGET_MS) {
          if (
            this.automatic &&
            this.quality === 'full' &&
            framePercentile95(this.frames) > 34
          )
            this.quality = 'lite'

          if (
            this.automatic &&
            this.quality === 'lite' &&
            framePercentile95(this.liteFrames) > 50
          )
            this.quality = 'static'
          this.complete = true
        }
        if (this.quality === 'static') this.complete = true
      }
    }
    this.last = now
  }
  report(): SceneProbeReport {
    return {
      fps: this.elapsed ? (1000 * this.frames.length) / this.elapsed : 0,
      p95: framePercentile95(this.frames),
      liteP95: this.liteFrames.length
        ? framePercentile95(this.liteFrames)
        : null,
      renderer: this.renderer,
      visibleMs: this.elapsed,
      samples: this.frames.length,
    }
  }
}
