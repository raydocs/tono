import { useRef, useState } from 'react';
import { createExclusiveGate } from '../../lib/exclusive';
import { Confirm } from '../../ui';

export function useAsk() {
  const gate = useRef(createExclusiveGate());
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useRef<(() => Promise<void>) | null>(null);

  return {
    dialog: (
      <Confirm
        open={open}
        title={title}
        detail={detail}
        busy={busy}
        error={error}
        onCancel={() => { if (!busy) { setOpen(false); setError(null); action.current = null; } }}
        onConfirm={async () => {
          if (!action.current) return;
          setBusy(true);
          setError(null);
          try {
            const ran = await gate.current.run(action.current);
            if (ran) {
              setOpen(false);
              action.current = null;
            }
          } catch {
            // error already recorded; keep the dialog open
          } finally {
            setBusy(false);
          }
        }}
      />
    ),
    prompt(nextTitle: string, nextDetail: string, run: () => Promise<void>) {
      if (gate.current.busy || busy) return;
      action.current = async () => {
        try {
          await run();
        } catch (err) {
          setError(err instanceof Error ? err.message : '没做成');
          throw err;
        }
      };
      setTitle(nextTitle);
      setDetail(nextDetail);
      setError(null);
      setOpen(true);
    },
  };
}
