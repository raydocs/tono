import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A neutral label that is sometimes a filter.
 *
 * `muted` is the unreleased case: a platform nobody has shipped a client for is
 * shown, greyed, with the reason in words — dropping the chip would let a
 * reader assume the platform is fine, and showing `0` would say nobody
 * upgraded when the truth is that nothing exists to upgrade to.
 */
export function Chip({
  children,
  active,
  muted,
  count,
  title,
  onClick,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  muted?: boolean;
  count?: number | null;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  const label = (
    <>
      <span>{children}</span>
      {count === null || count === undefined ? null : (
        <span className="font-mono text-[var(--muted-foreground)]">{count}</span>
      )}
    </>
  );
  if (!onClick) {
    return (
      <span title={title} className={cn('ops-chip', muted && 'ops-chip-muted', className)}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={muted}
      className={cn('ops-chip', muted && 'ops-chip-muted', className)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** A lifecycle tag. An inventory fact, never coloured. */
export function LifecycleTag({ children }: { children: ReactNode }) {
  return <span className="ops-tag">{children}</span>;
}
