import { useEffect } from 'react'
import { useNavigate } from 'react-router'

export const SHOW_UPDATE_EVENT = 'tono://show-update'
export const OPEN_UPDATE_STORAGE_KEY = 'tono-open-update'
export const OPEN_UPDATE_WINDOW_EVENT = 'tono-show-update'

/** Main window only. The tray asks; this opens Settings and the update dialog. */
export const UpdatePromptListener = () => {
  const navigate = useNavigate()
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen(SHOW_UPDATE_EVENT, () => {
          sessionStorage.setItem(OPEN_UPDATE_STORAGE_KEY, '1')
          navigate('/settings')
          window.dispatchEvent(new Event(OPEN_UPDATE_WINDOW_EVENT))
        }),
      )
      .then((stop) => {
        if (cancelled) stop()
        else unlisten = stop
      })
      .catch(() => {
        // Browser dev has no Tauri event bus.
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [navigate])
  return null
}
