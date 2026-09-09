import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * The count sentence, with its numbers counting.
 *
 * The sentence is the first thing on every page and it changes under the
 * reader — a filter lands, a refetch comes back, an incident resolves — and a
 * number that swaps in place is a change nobody sees. Rolling it over a third
 * of a second is the whole of the animation: it draws the eye to the figure
 * that moved and to nothing else.
 *
 * The words stay in `copy`: this takes the numbers and hands them back to the
 * sentence's own function, so an animating count cannot drift from the one
 * `copy` would have printed.
 */
export function CountText({
  values,
  render,
}: {
  values: readonly number[];
  render: (values: number[]) => string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<number[]>(() => [...values]);
  const from = useRef<number[]>([...values]);

  useEffect(() => {
    if (reduce) {
      from.current = [...values];
      setShown([...values]);
      return undefined;
    }
    const starts = from.current;
    const stops = values.map((to, index) => animate(starts[index] ?? to, to, {
      duration: 0.32,
      ease: 'easeOut',
      onUpdate: (value) => setShown((current) => {
        const next = [...current];
        next[index] = Math.round(value);
        return next;
      }),
    }));
    from.current = [...values];
    return () => { for (const stop of stops) stop.stop(); };
    // `values` is a fresh array every render; its contents are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, ...values]);

  return <>{render(shown)}</>;
}
