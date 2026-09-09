import type { ReactNode } from 'react';
import { copy } from '@/copy/copy';
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

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0">
      <span className="text-micro text-[var(--muted-foreground)]">{label}</span>
      <span className="font-mono text-body">{value}</span>
    </div>
  );
}
