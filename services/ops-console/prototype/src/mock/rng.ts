/** Seeded so every screenshot of the prototype shows the same world. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

export type Rng = ReturnType<typeof rng>;

/** A smooth daily curve: quiet at 04:00 Beijing, busiest around 22:00. */
export function diurnal(hourOfDayBeijing: number): number {
  const phase = ((hourOfDayBeijing - 22 + 24) % 24) / 24;
  return 0.55 + 0.45 * Math.cos(phase * 2 * Math.PI);
}

export function beijingHour(at: number): number {
  return (new Date(at).getUTCHours() + 8) % 24;
}
