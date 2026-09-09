import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';

/**
 * One block of the detail page: a hairline, a heading, an optional aside on
 * the right, and the body. The hairline is the page's only structure —
 * the reference layouts get their rhythm from visible rules, not from cards
 * stacked on cards.
 */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline gap-3 border-b border-[var(--hairline)] pb-2">
        {/* The heading keeps its line: on a phone an aside with two chips in
            it was breaking a four-character title across two rows. */}
        <h2 className="shrink-0 text-section">{title}</h2>
        <div className="ml-auto flex min-w-0 items-baseline gap-2">{aside}</div>
      </div>
      {children}
    </section>
  );
}

/** The same block, folded shut until asked: diagnostics, chores, billing. */
export function FoldedSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-baseline gap-2 border-b border-[var(--hairline)] pb-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={16} strokeWidth={1.75} className="translate-y-[3px]" />
        <h2 className="text-section">{title}</h2>
        {count === null || count === undefined ? null : (
          <span className="font-mono text-micro text-[var(--muted-foreground)]">{count}</span>
        )}
        <span className="ml-auto text-micro text-[var(--muted-foreground)]">
          {open ? copy.foldShut : copy.foldOpen}
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}
