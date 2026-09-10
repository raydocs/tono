import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { useWrite } from '../settings/use-write';

/**
 * One gate in front of every customer write, and the sentence it repeats.
 *
 * Everything on these pages changes something a paying customer feels within
 * minutes — a login that stops working, a line that reroutes, a device that is
 * kicked off — so nothing fires on the click. The caller hands over the
 * consequence as a finished sentence, and the confirming button repeats the
 * verb: what is read last is what the press does.
 *
 * The write itself is `useWrite`'s: pending while it runs, the hub's own
 * refusal shown in the dialog rather than swallowed, and a refetch afterwards
 * instead of patching the page's copy of the row. The hub owns the state
 * machine — re-enabling an account it is still revoking devices for is a 409,
 * not a success — so what the next read says is the only version worth
 * showing.
 */
export type AskSpec = {
  title: string;
  consequence: string;
  confirm: string;
  run: () => Promise<unknown>;
  /** An extra fact the dialog should carry; not a control — see `PickDialog`. */
  body?: ReactNode;
};

export function useAsk(reload: () => void) {
  const write = useWrite(reload);
  const [spec, setSpec] = useState<AskSpec | null>(null);

  function shut() {
    setSpec(null);
    write.setError(null);
  }

  const dialog = (
    <ConfirmDialog
      open={spec !== null}
      title={spec?.title ?? ''}
      consequence={spec?.consequence ?? ''}
      confirm={spec?.confirm ?? ''}
      pending={write.pending}
      failure={write.error}
      onConfirm={() => {
        const current = spec;
        if (!current) return;
        void write.run(current.run).then((done) => {
          if (done) shut();
        });
      }}
      onCancel={shut}
    >
      {spec?.body}
    </ConfirmDialog>
  );

  return {
    /** Open the gate. Nothing runs until the operator presses the verb again. */
    ask: (next: AskSpec) => {
      write.setError(null);
      setSpec(next);
    },
    /** A write that is not behind a gate — an edit form's save. */
    run: write.run,
    pending: write.pending,
    error: write.error,
    clearError: () => write.setError(null),
    busy: write.pending || spec !== null,
    dialog,
  };
}

/** The failure line a section shows when its own write was refused. */
export function WriteError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{message}</p>
  );
}
