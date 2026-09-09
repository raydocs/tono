import { useSyncExternalStore } from 'react';

/**
 * 640 px is where a two-column row stops being a row.
 *
 * The console's other breakpoint (960) is where the rail drops its words;
 * this one is where a layout has to change shape rather than shrink — an
 * incident line becomes a card, a right-hand drawer becomes a bottom sheet.
 * It is a hook rather than a media query because those two are structural:
 * CSS can restyle a drawer, it cannot move it to the other edge of Radix's
 * positioning.
 */
const PHONE = '(max-width: 640px)';

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(PHONE);
}

function subscribe(onChange: () => void): () => void {
  const mql = media();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
