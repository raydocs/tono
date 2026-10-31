/** How the sea moves for whoever can see it.
 *  - `live`: the full scene at the display's frame rate.
 *  - `throttled`: still visible but not in front (another app has focus, or an
 *    inner page shows it only blurred and dimmed). Every loop and phase
 *    transition keeps running; only the WebGL water drops to about 15 fps.
 *  - `held`: nobody can see it (hidden to the tray or minimised). Loops, water
 *    and in-flight transitions hold until the page is shown again. */
export type SeaSceneMotion = 'live' | 'throttled' | 'held'

export const seaSceneMotion = ({
  hidden,
  unfocused,
  blurred,
}: {
  hidden: boolean
  unfocused: boolean
  blurred: boolean
}): SeaSceneMotion => {
  if (hidden) return 'held'
  return unfocused || blurred ? 'throttled' : 'live'
}

/** Water frame interval while throttled (about 15 fps). */
export const THROTTLED_WATER_FRAME_MS = 1000 / 15
