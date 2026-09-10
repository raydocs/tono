import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy } from '@/copy/copy';
import { isAbortError } from '@/lib/api';
import { isConflict } from '@/lib/settings-legacy';
import { documentDiff, type LineDiff } from '@/lib/settings-publish';

/** One version of a document the fleet reads, as it is right now on the hub. */
export type Snapshot<E> = {
  revision: number;
  text: string;
  updatedAt: number | null;
  /** Whatever else that document carries — a signature, say. */
  extra: E;
};

/**
 * The outcome of the last thing pressed. `bad` is set for the one outcome that
 * is neither a success nor an error the operator can retry — a document that
 * moved underneath the draft — because that one has to be read before the next
 * click, and a plain grey line under a textarea is not read.
 */
export type Notice = { text: string; detail: string | null; bad: boolean };

export type PublishOutcome =
  | { ok: true; revision: number }
  | { ok: false };

/**
 * The catalogue and the routing rules, as one state machine.
 *
 * The whole reason this is a hook rather than two copies of `useState` is the
 * frozen base. `expectedRevision` is the hub's compare-and-swap, and the naive
 * way to fill it in — read the live revision at the moment of the publish —
 * makes the check unable to fire: the number always agrees with the server by
 * construction, so somebody else's publish lands underneath the draft and
 * disappears without an error anywhere. So the base revision *and* the base
 * text are frozen the moment the operator starts editing, a publish may only
 * ever claim that frozen number, and a 409 is treated as the correct answer:
 * the live document is fetched again, the draft is left exactly where it was,
 * and the operator is told which version they were working from, which version
 * is live now, and how far the two have drifted.
 *
 * `draft === null` means nobody is editing. That is a different state from a
 * draft that happens to equal the live text, because leaving the editor open
 * with no changes is a thing an operator does on purpose.
 */
export function useDocument<E>(load: (signal: AbortSignal) => Promise<Snapshot<E>>) {
  const loader = useRef(load);
  loader.current = load;

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState<Snapshot<E> | null>(null);
  const [base, setBase] = useState<{ revision: number; text: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setStatus('loading');
    loader.current(ac.signal).then(
      (data) => {
        if (cancelled) return;
        setOnline(data);
        setStatus('ready');
      },
      (error: unknown) => {
        if (cancelled || isAbortError(error)) return;
        setMessage(error instanceof Error ? error.message : copy.loadError);
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  /** Open the editor on the live text, and freeze what it was opened against. */
  const start = useCallback(() => {
    if (!online) return;
    setBase({ revision: online.revision, text: online.text });
    setDraft(online.text);
    setNotice(null);
    setFailure(null);
  }, [online]);

  const change = useCallback((text: string) => {
    setDraft(text);
    setFailure(null);
  }, []);

  /** Fetch the live document again and hand the editor that text instead. */
  const reload = useCallback(async (told: (row: Snapshot<E>) => Notice): Promise<boolean> => {
    setPending(true);
    setFailure(null);
    try {
      const fresh = await loader.current(new AbortController().signal);
      setOnline(fresh);
      setStatus('ready');
      setBase({ revision: fresh.revision, text: fresh.text });
      setDraft(fresh.text);
      setNotice(told(fresh));
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.loadError);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  /**
   * Send the draft, claiming the frozen base. `told` writes the sentence for a
   * publish that landed; `conflict` writes the one for a document that moved,
   * and is handed both revisions plus the drift between the base and what is
   * live now — the "what changed" an operator needs to merge by hand.
   */
  const publish = useCallback(async (
    send: (expectedRevision: number) => Promise<number>,
    words: {
      told: (was: number, now: number) => Notice;
      conflict: (was: number, fresh: Snapshot<E>, drift: LineDiff) => Notice;
    },
  ): Promise<PublishOutcome> => {
    const frozen = base;
    if (!frozen) return { ok: false };
    setPending(true);
    setFailure(null);
    setNotice(null);
    try {
      const revision = await send(frozen.revision);
      setOnline((current) => (current
        ? { ...current, revision, text: draft ?? current.text }
        : current));
      setBase({ revision, text: draft ?? frozen.text });
      setNotice(words.told(frozen.revision, revision));
      return { ok: true, revision };
    } catch (error) {
      const said = error instanceof Error ? error.message : copy.actionFailed;
      if (!isConflict(error)) {
        setFailure(said);
        return { ok: false };
      }
      // The draft stays exactly as typed; only the live copy is refreshed, so
      // nothing the operator wrote is spent on discovering the conflict.
      try {
        const fresh = await loader.current(new AbortController().signal);
        setOnline(fresh);
        setNotice(words.conflict(frozen.revision, fresh, documentDiff(frozen.text, fresh.text)));
      } catch {
        setFailure(said);
      }
      return { ok: false };
    } finally {
      setPending(false);
    }
  }, [base, draft]);

  const diff = useMemo(
    () => (draft === null || base === null ? null : documentDiff(base.text, draft)),
    [draft, base],
  );

  return {
    status,
    message,
    online,
    base,
    draft,
    diff,
    notice,
    failure,
    pending,
    start,
    change,
    reload,
    publish,
    setNotice,
    setFailure,
  };
}
