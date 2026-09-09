import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { copy } from '@/copy/copy';
import { SPRING } from '@/lib/motion';
import type { Measured } from './measured';
import { Value, type Tier } from './Value';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * The drawer, on a spring.
 *
 * Radix positions and traps focus; the panel it renders is left transparent
 * and unanimated (`drawer-shell` kills the keyframes it ships with) so the
 * visible surface can be a `motion.div` that comes in on the plan's 260/30.
 * A slide with a fixed duration arrives at a constant speed and stops dead;
 * the spring decelerates, which is what makes the panel feel attached to the
 * click rather than scheduled by it.
 */
export function DetailDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="right"
        className="drawer-shell w-[420px] border-0 bg-transparent p-0 shadow-none sm:max-w-[420px]"
      >
        <motion.div
          initial={reduce ? false : { x: '100%' }}
          animate={{ x: 0 }}
          transition={SPRING}
          className="flex h-full min-h-0 flex-col border-l border-[var(--hairline)] bg-[var(--surface)]"
        >
          <SheetHeader className="shrink-0 border-b border-[var(--hairline)] px-5 py-4">
            <SheetTitle className="text-row font-medium">{title}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">{children}</div>
          <div className="shrink-0 px-5 pb-5">
            <button
              type="button"
              className="text-micro text-[var(--muted-foreground)]"
              onClick={onClose}
            >
              {copy.close}
            </button>
          </div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
}

/** One flat fact, obeying R2 through `Value` like every other number on screen. */
export function Fact({
  label,
  measured,
  render,
  tier,
}: {
  label: string;
  measured: Measured<string | null>;
  render?: (value: string) => string;
  tier?: Tier;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0">
      <span className="text-micro text-[var(--muted-foreground)]">{label}</span>
      <Value
        value={measured.value === null ? null : (render ? render(measured.value) : measured.value)}
        source={measured.source}
        mono
        tier={tier}
        className="text-right"
      />
    </div>
  );
}
