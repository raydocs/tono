import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copy } from '@/copy/copy';
import { formatWhen } from '@/lib/display';
import type { LineDiff } from '@/lib/settings-publish';
import { cn } from '@/lib/utils';
import type { Notice } from './use-document';

/**
 * The furniture the two publishing sections share: a text box you can count
 * lines in, the comparison against what is live, and the one line that says how
 * the last press went.
 *
 * A plain textarea with a gutter rather than an editor component. What an
 * operator does here is paste a block, delete a block, and read a line number
 * out of a refusal — none of which is helped by syntax colouring, and all of
 * which is hurt by a control that reflows text on its own.
 */

const LINE = 'font-mono text-[12px] leading-[18px]';

export function CodeBox({
  label,
  value,
  onChange,
  height = 'h-[340px]',
}: {
  label: string;
  value: string;
  onChange?: (text: string) => void;
  height?: string;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;
  const numbers: number[] = [];
  for (let at = 1; at <= lines; at += 1) numbers.push(at);

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]">
      {/* The strip is static so the numbers cannot scroll out from behind it;
          only the column of digits inside is moved, in step with the box. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-11 overflow-hidden border-r border-[var(--hairline)] bg-[var(--surface)]"
      >
        <div ref={gutter} className={cn(LINE, 'select-none px-2 py-2 text-right text-[var(--muted-foreground)]')}>
          {numbers.map((at) => <div key={at}>{at}</div>)}
        </div>
      </div>
      <textarea
        aria-label={label}
        spellCheck={false}
        wrap="off"
        readOnly={onChange === undefined}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onScroll={(event) => {
          const column = gutter.current;
          if (column) column.style.transform = `translateY(-${String(event.currentTarget.scrollTop)}px)`;
        }}
        className={cn(
          LINE,
          height,
          'relative block w-full resize-none bg-transparent py-2 pl-[52px] pr-3 outline-none',
        )}
      />
    </div>
  );
}

/**
 * Added and removed lines, in the two faintest washes the palette has.
 *
 * The settings page has no status colours anywhere else, and these are the
 * exception on purpose: which lines are going and which are arriving is the one
 * thing on this page a shape cannot say. The sign in the first column carries
 * the same information for anyone who cannot separate the two washes.
 */
const DIFF_TONE: Record<'eq' | 'add' | 'del', string> = {
  eq: 'text-[var(--muted-foreground)]',
  add: 'diff-add',
  del: 'diff-del',
};

const DIFF_SIGN: Record<'eq' | 'add' | 'del', string> = { eq: ' ', add: '+', del: '-' };

export function DiffView({
  diff,
  summary,
  truncated,
}: {
  diff: LineDiff;
  summary: string;
  truncated: string | null;
}) {
  return (
    <div className="flex flex-col gap-2" data-diff>
      <p className="text-micro text-[var(--muted-foreground)]">{summary}</p>
      <div className="max-h-[280px] overflow-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)]">
        {diff.hunks.map((hunk, index) => (
          <pre
            key={`${hunk.aStart}-${hunk.bStart}-${index}`}
            className={cn(LINE, 'border-b border-[var(--hairline)] py-1 last:border-b-0')}
          >
            {hunk.lines.map((line, at) => (
              <span key={at} className={cn('block whitespace-pre px-3', DIFF_TONE[line.kind])}>
                {DIFF_SIGN[line.kind]}
                {line.text}
              </span>
            ))}
          </pre>
        ))}
      </div>
      {truncated ? <p className="text-micro text-[var(--muted-foreground)]">{truncated}</p> : null}
    </div>
  );
}

/** How the last press went. A refusal borrows the page's one error treatment. */
export function NoticePanel({ notice }: { notice: Notice }) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-1 rounded-[10px] px-3 py-2',
        notice.bad ? 'panel-error' : 'border border-[var(--hairline)] bg-[var(--surface)]',
      )}
    >
      <p className="text-body">{notice.text}</p>
      {notice.detail ? <p className="text-fine">{notice.detail}</p> : null}
    </div>
  );
}

export function FailurePanel({ failure }: { failure: string }) {
  return (
    <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{failure}</p>
  );
}

/**
 * Which version is live, when it was published, and what you can press.
 *
 * The date goes through `formatWhen` like every other stamp in the console; the
 * revision does not, because it is a name rather than a measurement — r38 is
 * not more or less than r37, it is simply the one after it.
 */
export function DocumentMeta({
  version,
  updatedAt,
  never,
  updatedWord,
  children,
}: {
  version: string;
  updatedAt: number | null;
  never: string;
  updatedWord: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--hairline)] pb-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-row">{version}</span>
        <span className="text-micro text-[var(--muted-foreground)]">{updatedWord}</span>
        <span className="font-mono text-fine">
          {updatedAt === null ? never : formatWhen(updatedAt)}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The read-only text of something the hub computed: the canonical rules, the
 * line a signature is made over.
 *
 * It does not wrap and it is not prettified, because both of those change the
 * bytes, and the reason this text is on screen at all is that something offline
 * has to be run over exactly these ones. The copy button is the point of the
 * block — nobody signs a document by retyping it out of a scroll box.
 */
export function CanonicalBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <p className="text-micro text-[var(--muted-foreground)]">{title}</p>
        <button
          type="button"
          className="ml-auto text-micro text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? copy.settings.copied : copy.settings.copyText}
        </button>
      </div>
      <pre className={cn('max-h-[200px] overflow-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] p-3 whitespace-pre', LINE)}>
        {text}
      </pre>
    </div>
  );
}

/** The loading and error states both editors show before there is a document. */
export function DocumentGate({ status, message }: { status: 'loading' | 'error'; message: string }) {
  if (status === 'loading') {
    return (
      <div
        className="rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 py-10 text-center text-[var(--muted-foreground)]"
        role="status"
      >
        {copy.loading}
      </div>
    );
  }
  return (
    <div className="panel-error rounded-[10px] px-5 py-10 text-center" role="alert">
      {message || copy.loadError}
    </div>
  );
}
