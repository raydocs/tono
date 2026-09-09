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
  action,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  /** One link beside the title — where the drawer's subject has a page of its own. */
  action?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] border-l border-[var(--hairline)] bg-[var(--surface)] p-0">
        <SheetHeader className="border-b border-[var(--hairline)] px-5 py-4">
          <div className="flex items-baseline gap-3">
            <SheetTitle className="min-w-0 truncate text-row font-medium">{title}</SheetTitle>
            {action ? <div className="ml-auto shrink-0">{action}</div> : null}
          </div>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">{children}</div>
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
