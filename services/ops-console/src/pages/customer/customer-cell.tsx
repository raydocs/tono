import type { ReactNode } from 'react';
import { copy } from '@/copy/copy';

/**
 * The row's name: the address, and under it the WeChat id when there is one.
 *
 * The two answer the same question, which person is this row, so they share a
 * cell the way the node cell stacks its city and site. The id is the quiet
 * second line (11 px, one line, the full id with an ellipsis only as a safety
 * net), which keeps every row 36 px. Both are already masked by the caller;
 * the hovers carry the masked text too, because a privacy switch that a
 * pointer undoes was never on. At phone width the second line is left off:
 * the phone keeps three columns and one line per row.
 */
export function CustomerCell({
  address,
  tag,
  wechatId,
  duplicate = false,
}: {
  address: string;
  tag?: ReactNode;
  wechatId: string | null;
  duplicate?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <div className="flex items-baseline gap-2" title={address}>
        <span className="min-w-0 truncate text-row">{address}</span>
        {tag}
      </div>
      {wechatId === null || wechatId === '' ? null : (
        <span
          className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)] max-[640px]:hidden"
          title={duplicate ? `${wechatId} · ${copy.wechatDuplicateTitle}` : wechatId}
        >
          {wechatId}
          {duplicate ? <span className="ml-1.5">{copy.wechatDuplicate}</span> : null}
        </span>
      )}
    </div>
  );
}
