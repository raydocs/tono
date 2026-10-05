import { useEffect, type RefObject } from 'react'

const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'

/** A local modal boundary; hidden sheet contents stay mounted but cannot receive focus. */
export const useHomeDialog = (
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  close: () => void,
) => {
  useEffect(() => {
    if (!open) return
    const returnTarget = trigger.current
    const element = panel.current
    if (!element) return
    const items = () =>
      Array.from(element.querySelectorAll<HTMLElement>(focusable)).filter(
        (item) => !item.closest('[inert], [hidden]'),
      )
    const first = () => (items()[0] ?? element).focus()
    first()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === 'Tab') {
        const list = items()
        const index = list.indexOf(document.activeElement as HTMLElement)
        if (!list.length) {
          event.preventDefault()
          element.focus()
        } else if (event.shiftKey && index <= 0) {
          event.preventDefault()
          list.at(-1)?.focus()
        } else if (
          !event.shiftKey &&
          (index < 0 || index === list.length - 1)
        ) {
          event.preventDefault()
          list[0]?.focus()
        }
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !element.contains(event.target))
        first()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
      if (returnTarget?.isConnected) returnTarget.focus()
    }
  }, [open, panel, trigger, close])
}
