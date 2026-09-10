import { useEffect, useRef, useState } from 'react';

/**
 * The shell's one heartbeat.
 *
 * A console left open on a second monitor was showing whatever the fleet looked
 * like when the tab was opened — an hour-old world with no sign that it was
 * old. This is the only timer in the app: every shared read hangs off the same
 * beat, so a minute costs one round of requests rather than one per page.
 *
 * Nothing polls a hidden tab: a laptop asleep in a bag has no operator reading
 * it, and waking to a burst of catch-up requests is worse than one fetch on the
 * way back. Coming back is exactly when the answer matters most, so returning
 * to the tab beats immediately — both events that mean "back", debounced,
 * because a tab switch fires two of them.
 */
const SETTLE_MS = 5_000;

export function useBeat(seconds: number): number {
  const [beat, setBeat] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    // The first render has just fetched everything; the focus event that
    // arrives with it must not fetch it all again.
    last.current = Date.now();
    const bump = () => {
      const at = Date.now();
      if (at - last.current < SETTLE_MS) return;
      last.current = at;
      setBeat((n) => n + 1);
    };
    const onReturn = () => {
      if (document.visibilityState === 'visible') bump();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      last.current = Date.now();
      setBeat((n) => n + 1);
    }, seconds * 1_000);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [seconds]);

  return beat;
}
