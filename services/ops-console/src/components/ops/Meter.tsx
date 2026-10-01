import { cn } from '@/lib/utils';
import type { Tone } from './StatusWord';

/**
 * A short filled bar for a share of something — a quota, the probes that got
 * through. Decorative: the number beside it is what a screen reader hears.
 * No ratio draws an empty track, never a zero-width fill that reads as 0 %.
 */
export function Meter({ ratio, tone, className }: { ratio: number | null; tone?: Tone | null; className?: string }) {
  return (
    <span className={cn('meter', tone && `tone-${tone}`, className)} aria-hidden>
      {ratio === null ? null : <span style={{ ['--fill' as string]: Math.min(1, Math.max(0.02, ratio)) }} />}
    </span>
  );
}
