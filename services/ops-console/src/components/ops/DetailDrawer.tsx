import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { copy } from '@/copy/copy';
import { SPRING } from '@/lib/motion';
import { useIsPhone } from '@/lib/use-phone';
import { cn } from '@/lib/utils';
import type { Measured } from './measured';
import { Value, type Tier } from './Value';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * The drawer, on a spring — and on a phone, a bottom sheet.
 *
 * Radix positions and traps focus; the panel it renders is left transparent
 * and unanimated (`drawer-shell` kills the keyframes it ships with) so the
 * visible surface can be a `motion.div` that comes in on the plan's 260/30.
 * A slide with a fixed duration arrives at a constant speed and stops dead;
 * the spring decelerates, which is what makes the panel feel attached to the
 * click rather than scheduled by it.
 *
 * At 390 px a 420 px panel sliding in from the right is the whole screen
 * arriving sideways, and the thumb that opened it is at the bottom. So below
 * 640 px the same panel comes up from the bottom edge instead, and `footer`
 * — the actions — is pinned there where the thumb already is, rather than
 * scrolling somewhere past the fold.
 */
export function DetailDrawer({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Pinned to the bottom edge; on a phone that is where the thumb is. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const phone = useIsPhone();
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        className={cn(
          'drawer-shell border-0 bg-transparent p-0 shadow-none',
          phone ? 'h-[86vh]' : 'w-[420px] sm:max-w-[420px]',
        )}
        /**
         * Radix hands focus to the first tabbable thing it finds, which while
         * the detail is still loading is the close button — so every drawer
         * opened with a focus ring around the one control that throws the
         * drawer away. Focus goes to the panel instead: still inside the trap,
         * still the top of the tab order, no ring around 'close'.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panel.current?.focus();
        }}
      >
        <motion.div
          ref={panel}
          tabIndex={-1}
          initial={reduce ? false : (phone ? { y: '100%' } : { x: '100%' })}
          animate={phone ? { y: 0 } : { x: 0 }}
          transition={SPRING}
          className={cn(
            'flex h-full min-h-0 flex-col bg-[var(--surface)]',
            phone
              ? 'rounded-t-[16px] border-t border-[var(--hairline)]'
              : 'border-l border-[var(--hairline)]',
          )}
        >
          <SheetHeader className="shrink-0 border-b border-[var(--hairline)] px-5 py-4">
            <SheetTitle className="text-row font-medium">{title}</SheetTitle>
          </SheetHeader>
          {/* On a wide screen the actions stay where they were written, at the
              end of the panel: pinning them there would leave a 400 px void
              above the bar on a short incident. On a phone the fold is real,
              so they come out of the flow and sit on the bottom edge. */}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
            {children}
            {phone ? null : footer}
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--hairline)] px-5 py-4">
            {phone ? footer : null}
            <button
              type="button"
              className="self-start text-micro text-[var(--muted-foreground)]"
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
