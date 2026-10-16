import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A button, and — when it cannot be pressed — the reason in words.
 *
 * Every disabled action on these pages is disabled for a reason the operator
 * can act on — no endpoint yet, no such action on this platform — so the reason
 * travels with the button as its title and its `aria-describedby` text rather
 * than living in a comment. A greyed control with no explanation is the thing
 * that makes people reload the page.
 *
 * `danger` marks an action that takes something away from a customer or the
 * fleet (suspending an account, withdrawing a release). It is outlined in the
 * severity colour so it does not sit in a row looking like the expiry edit
 * beside it; its confirm is filled in the same colour.
 */
export function Action({
  children,
  primary,
  danger,
  reason,
  pending,
  onClick,
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  danger?: boolean;
  reason?: string | null;
  pending?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const blocked = Boolean(reason) || pending === true;
  const reasonId = useId();
  // aria-disabled, not disabled: a disabled button leaves the tab order, so a
  // keyboard user never meets the reason. This one stays focusable and says why.
  // The reason is `hidden`, not sr-only: aria-describedby still reads it, and an
  // absolutely placed span inside a scrolled table stretched the phone page sideways.
  return (
    <>
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked && reason ? reasonId : undefined}
        title={reason || undefined}
        className={cn('ops-action', primary && 'ops-action-primary', danger && 'ops-action-danger', className)}
        onClick={blocked ? undefined : onClick}
      >
        {children}
      </button>
      {blocked && reason ? <span id={reasonId} hidden>{reason}</span> : null}
    </>
  );
}

/** A row of actions with one primary. Colour on a page belongs to exactly one. */
export function ActionRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
