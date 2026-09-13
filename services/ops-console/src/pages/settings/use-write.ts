import { useCallback, useRef, useState } from 'react';
import { copy } from '@/copy/copy';

/**
 * One write, its pending flag and its failure sentence.
 *
 * Every section on 设置 does the same thing after a POST: refetch rather than
 * patch its own copy. The Worker owns the record — it masks an email, stamps
 * an `updatedAt`, refuses a channel it does not know — so what comes back from
 * the next read is the only version worth showing.
 */
export function useWrite(reload: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(reload);
  latest.current = reload;

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await action();
      latest.current();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.actionFailed);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, setError, run };
}
