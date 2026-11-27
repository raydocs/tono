import { useEffect } from 'react'

export const SHOW_UPDATE_EVENT = 'tono://show-update'
export const OPEN_UPDATE_STORAGE_KEY = 'tono-open-update'
export const OPEN_UPDATE_WINDOW_EVENT = 'tono-show-update'

const dispatchOpenUpdate = () => {
  try {
    sessionStorage.setItem(OPEN_UPDATE_STORAGE_KEY, '1')
  } catch {
    // Ignore storage failures in restricted webviews.
  }
  window.dispatchEvent(new Event(OPEN_UPDATE_WINDOW_EVENT))
}

/** Main window only. The tray asks; this opens the global update dialog. */
export const UpdatePromptListener = () => {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ])
      .then(async ([{ invoke }, { listen }]) => {
        const stop = await listen(SHOW_UPDATE_EVENT, () => {
          void Promise.resolve(invoke('take_pending_update_prompt')).catch(
            () => false,
          )
          dispatchOpenUpdate()
        })
        if (cancelled) {
          stop()
          return
        }
        unlisten = stop
        const pending = await invoke<boolean>('take_pending_update_prompt').catch(
          () => false,
        )
        if (!cancelled && pending) {
          dispatchOpenUpdate()
        }
      })
      .catch(() => {
        // Browser dev has no Tauri event bus.
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
  return null
}
