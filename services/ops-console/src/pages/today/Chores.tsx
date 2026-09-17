import { useState } from 'react';
import { Action } from '@/components/ops/Action';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import type { Chore } from '@/lib/chores';
import { formatDate } from '@/lib/display';
import { openCustomer, openInvite, openNodePage } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';

/**
 * The chores, and the two things a chore about a person needs that a chore
 * about a machine does not.
 *
 * A renewal is a date and a sentence: read it, act on it somewhere else. An
 * onboarding is a person who has to be asked something, so the row carries the
 * handle to ask them on and a way into whatever page they have — the 360 for a
 * customer, the invite drawer for somebody who never registered. Without those
 * two the row was a sentence telling an operator to go and look up a WeChat id
 * in another tab, which is how a chore list becomes wallpaper.
 *
 * The handle prints masked and copies real, exactly as it does on the 360: the
 * point of the button is to paste it into WeChat.
 */
export function ChoreList({ rows }: { rows: readonly Chore[] }) {
  if (rows.length === 0) return <Empty message={copy.noChores} />;
  return (
    <ul className="today-chore-list flex flex-col">
      {rows.map((chore) => (
        <ChoreRow key={chore.id} chore={chore} />
      ))}
    </ul>
  );
}

function ChoreRow({ chore }: { chore: Chore }) {
  const privacy = usePrivacy();
  const who = chore.who;
  const handle = who?.wechatId ?? null;

  /**
   * Two spans, not one line: the sentence owns a growing span while the
   * attachments (handle, copy, date) sit in a trailing span that only wraps
   * underneath. One shared flex line let the fixed attachments squeeze the
   * sentence to a few pixels on a 320 px phone — the page reported no
   * sideways overflow while the row read `de...`. Sizing stays in local
   * utilities; the shared Action is untouched.
   */
  const line = (
    <>
      <span className="flex min-w-0 flex-1 basis-64 items-baseline gap-3 max-[640px]:basis-full">
        <span className="tone-rem ops-tag shrink-0">{copy.choreKind[chore.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-body max-[640px]:whitespace-normal">{chore.summary}</span>
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 max-[640px]:ml-0">
        {/* `text-fine` rather than the micro tier: that one is the label style
            and upper-cases what it is given, and WX_MA_QIANG is not the handle
            anybody would paste into WeChat. */}
        {who === undefined ? null : (
          <span className="shrink-0 text-fine">
            {handle === null ? copy.missing : privacy.wechat(handle)}
          </span>
        )}
        {who === undefined ? null : <CopyHandle handle={handle} />}
        <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
          {chore.dueAt === null ? copy.missing : formatDate(chore.dueAt)}
        </span>
      </span>
    </>
  );

  if (who === undefined && chore.node === undefined) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--hairline)] py-2.5 last:border-b-0">
        {line}
      </li>
    );
  }
  return (
    <li className="border-b border-[var(--hairline)] last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-left"
        onClick={() => open(chore)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          open(chore);
        }}
      >
        {line}
      </div>
    </li>
  );
}

/** The 360 for somebody with an account; the drawer for somebody without one; the detail page for a machine. */
function open(chore: Chore): void {
  const who = chore.who;
  if (who !== undefined) {
    if (who.userId === null) openInvite(who.email);
    else openCustomer(who.userId);
    return;
  }
  if (chore.node !== undefined) openNodePage(chore.node);
}

function CopyHandle({ handle }: { handle: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      className="shrink-0"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <Action
        reason={handle === null ? copy.choreNoWechat : null}
        className="max-[640px]:inline-flex max-[640px]:min-h-[44px] max-[640px]:items-center"
        onClick={() => {
          if (handle === null) return;
          void navigator.clipboard?.writeText(handle).then(() => setCopied(true));
        }}
      >
        {copied ? copy.copiedWechat : copy.copyWechat}
      </Action>
    </span>
  );
}
