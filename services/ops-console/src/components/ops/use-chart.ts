import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/**
 * The rendered width of a chart's box. Charts draw in real pixels rather
 * than a stretched viewBox so an 11 px tick label stays 11 px on a phone and
 * a hairline stays one pixel on a wide screen.
 */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The column a reader is looking at, driven by the pointer or the keyboard.
 *
 * The keyboard half is not decoration: without it the hover readout is the
 * only way to get a number out of a chart, and a reader who cannot aim a
 * mouse gets the shape and nothing else.
 */
export function useCursor(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const clear = useCallback(() => setIndex(null), []);
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (count === 0) return;
    const last = count - 1;
    const step = event.shiftKey ? 10 : 1;
    let next: number | null;
    switch (event.key) {
      case 'ArrowRight': next = index === null ? last : Math.min(last, index + step); break;
      case 'ArrowLeft': next = index === null ? last : Math.max(0, index - step); break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'Escape': next = null; break;
      default: return;
    }
    event.preventDefault();
    setIndex(next);
  }, [count, index]);
  return { index: index !== null && index < count ? index : null, setIndex, clear, onKeyDown };
}
