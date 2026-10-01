import { useId, type ReactNode } from 'react';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { formatWhenAgo } from '@/lib/display';
import { cn } from '@/lib/utils';

export type PanelState = 'ready' | 'loading' | 'error' | 'empty';

/**
 * One raised block of a page: a heading, an optional line under it, actions
 * on the right, the body, and a footer that says where the numbers came from
 * and how old they are.
 *
 * The footer is not optional in spirit. A panel of numbers with no source and
 * no age is the thing this console was rebuilt to stop showing (R1): pass
 * `source` and `asOfSec` for anything measured. A panel whose data has gone
 * past `staleAfterSec` says so in words, in the warn tone, rather than
 * quietly presenting last night's figures as this morning's.
 *
 * Loading, error and empty are states of the panel, not of each caller, so a
 * failed block looks the same on every page and never takes its neighbours
 * down with it.
 */
export function Panel({
  title,
  description,
  actions,
  source,
  asOfSec,
  staleAfterSec,
  state = 'ready',
  emptyText,
  onRetry,
  bodyHeight = 120,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  source?: string;
  asOfSec?: number | null;
  /** How old the data may be before the panel warns that it is stale. */
  staleAfterSec?: number;
  state?: PanelState;
  emptyText?: string;
  onRetry?: () => void;
  /** Reserved while loading or failed, so the page does not jump when data lands. */
  bodyHeight?: number;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const stale = state === 'ready'
    && staleAfterSec !== undefined
    && asOfSec != null
    && nowSec() - asOfSec > staleAfterSec;
  const hasFooter = source !== undefined || asOfSec !== undefined;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state === 'loading' || undefined}
      className={cn('raised flex min-w-0 flex-col gap-4 rounded-[10px] bg-[var(--surface)] p-5', className)}
    >
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={headingId} className="text-row">{title}</h2>
          {description ? <p className="text-fine">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      <PanelBody state={state} emptyText={emptyText} onRetry={onRetry} height={bodyHeight}>
        {children}
      </PanelBody>

      {hasFooter ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--hairline)] pt-3 text-fine">
          {source !== undefined ? <span>{copy.panelSource(source)}</span> : null}
          {asOfSec !== undefined ? (
            <span className="font-mono">{copy.panelAsOf(formatWhenAgo(asOfSec))}</span>
          ) : null}
          {stale ? <span className="tone-warn tone-fg font-medium">{copy.panelStale}</span> : null}
        </footer>
      ) : null}
    </section>
  );
}

function PanelBody({
  state,
  emptyText,
  onRetry,
  height,
  children,
}: {
  state: PanelState;
  emptyText?: string;
  onRetry?: () => void;
  height: number;
  children?: ReactNode;
}) {
  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2" style={{ minHeight: height }}>
        <span className="sr-only" role="status">{copy.panelLoading}</span>
        <div className="panel-skeleton h-3 w-2/5" />
        <div className="panel-skeleton flex-1" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start justify-center gap-3" style={{ minHeight: height }}>
        <p className="tone-sev tone-fg">{copy.panelError}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="panel-action rounded-[6px] border border-[var(--hairline)] px-3 py-1 text-body hover:bg-[var(--hover-wash)]"
          >
            {copy.panelRetry}
          </button>
        ) : null}
      </div>
    );
  }
  if (state === 'empty') {
    return (
      <div className="flex items-center text-[var(--muted-foreground)]" style={{ minHeight: height }}>
        {emptyText ?? copy.panelEmpty}
      </div>
    );
  }
  return <div className="min-w-0">{children}</div>;
}
