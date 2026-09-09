import type { ReactNode } from 'react';
import { copy } from '@/copy/copy';
import type { Measured } from './measured';
import { Value } from './Value';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] border-l border-[var(--hairline)] bg-[var(--surface)] p-0">
        <SheetHeader className="border-b border-[var(--hairline)] px-5 py-4">
          <SheetTitle className="text-row font-medium">{title}</SheetTitle>
        </SheetHeader>
        {/* A form taller than the screen has to scroll, or its save button sits
            below the fold with nothing to reach it: `min-h-0` is what lets the
            flex child shrink far enough for its own overflow to take effect. */}
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">{children}</div>
        <div className="px-5 pb-5">
          <button
            type="button"
            className="text-micro text-[var(--muted-foreground)]"
            onClick={onClose}
          >
            {copy.close}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One flat fact, obeying R2 through `Value` like every other number on screen. */
export function Fact({
  label,
  measured,
  render,
}: {
  label: string;
  measured: Measured<string | null>;
  render?: (value: string) => string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0">
      <span className="text-micro text-[var(--muted-foreground)]">{label}</span>
      <Value
        value={measured.value === null ? null : (render ? render(measured.value) : measured.value)}
        source={measured.source}
        mono
        className="text-right"
      />
    </div>
  );
}
