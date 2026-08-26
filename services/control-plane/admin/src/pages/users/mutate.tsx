import { useRef, useState } from 'react';
import { createExclusiveGate } from '../../lib/exclusive';

export function useMutation() {
  const gate = useRef(createExclusiveGate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function run(action: () => Promise<void>, success?: string): Promise<boolean> {
    if (busy || gate.current.busy) return false;
    setBusy(true);
    setError(null);
    try {
      const ran = await gate.current.run(action);
      if (ran && success) setOk(success);
      return ran;
    } catch (err) {
      setError(err instanceof Error ? err.message : '没做成');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, ok, run, setError, setOk };
}
