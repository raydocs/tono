/** Ticks only while the window is visible, and once on return so the reading is current. */
export const whileVisible = (tick: () => void, every: number) => {
  let initial: number | undefined
  let timer: number | undefined
  const stop = () => {
    window.clearTimeout(initial)
    window.clearInterval(timer)
  }
  const sync = () => {
    stop()
    if (document.visibilityState === 'hidden') return
    initial = window.setTimeout(tick, 0)
    timer = window.setInterval(tick, every)
  }
  document.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    document.removeEventListener('visibilitychange', sync)
    stop()
  }
}
