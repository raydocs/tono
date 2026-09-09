import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A button, and — when it cannot be pressed — the reason in words.
 *
 * Every disabled action on these pages is disabled for a reason the operator
 * can act on ("接口未接入", "Windows 客户端还没有这个动作"), so the reason
 * travels with the button as its title and its `aria-describedby` text rather
 * than living in a comment. A greyed control with no explanation is the thing
 * that makes people reload the page.
 */
export function Action({
  children,
  primary,
  reason,
  pending,
  onClick,
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  reason?: string | null;
  pending?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const blocked = Boolean(reason) || pending === true;
  return (
    <button
      type="button"
      disabled={blocked}
      title={reason || undefined}
      className={cn('ops-action', primary && 'ops-action-primary', className)}
      onClick={blocked ? undefined : onClick}
    >
      {children}
    </button>
  );
}

/** A row of actions with one primary. Colour on a page belongs to exactly one. */
export function ActionRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
