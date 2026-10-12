import { useRef } from 'react';

type AutoFocus = (event: Event) => void;

/**
 * Hands focus back to whatever opened a dialog or drawer.
 *
 * Radix only returns focus to a `Trigger`, and these panels are opened by a
 * button that sets state, so on close focus fell to the page body and a
 * keyboard user restarted from the top. The element focused at the moment the
 * panel mounts is the opener; it is refocused on close if it is still there.
 * With no focused opener (a pointer click in Safari) Radix keeps its default.
 */
export function useRestoreFocus(handlers: { onOpenAutoFocus?: AutoFocus; onCloseAutoFocus?: AutoFocus }) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      handlers.onCloseAutoFocus?.(event);
      const target = opener.current;
      opener.current = null;
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
