import { useEffect, useState } from 'react';
import type { CustomerSummaryDto } from '@contract';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { batchCopy } from '@/copy/batch';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { absoluteExpiryPatch } from '@/lib/customer-facts';
import { startBatch } from '@/lib/customer-batch';
import { formatDate } from '@/lib/display';
import { FieldGrid, TextField } from '../settings/form';
import { useAsk } from './ask';

/**
 * One date for everybody picked, behind the same gate as every other batch.
 *
 * The sentence names how many people and the exact day, because "set the
 * expiry" is not checkable and "twenty-two people, 2026-12-31" is. The write
 * itself is the cohort's own: one PATCH per customer, results kept in the
 * panel above the table, so this dialog only has to take the date.
 */
export function ExpiryBatchDialog({
  open,
  rows,
  blocked,
  onClose,
  onChanged,
}: {
  open: boolean;
  rows: readonly CustomerSummaryDto[];
  /** An earlier batch's results are still on the page; a second would be dropped. */
  blocked: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(onChanged);
  const [typed, setTyped] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setFault(null);
  }, [open]);

  if (!open) return null;
  const patch = absoluteExpiryPatch(typed, nowSec());
  return (
    <ConfirmDialog
      open
      title={copy.batchExpiryTitle}
      consequence={patch === null
        ? copy.batchExpiryLead(rows.length)
        : copy.batchExpiryBody(rows.length, formatDate(patch.expiresAt))}
      confirm={copy.batchExpiryConfirm}
      pending={ask.pending}
      failure={fault ?? ask.error}
      onConfirm={() => {
        if (blocked) {
          setFault(batchCopy.previous);
          return;
        }
        if (patch === null) {
          setFault(copy.batchExpiryInvalid);
          return;
        }
        setFault(null);
        void ask.run(() => startBatch('expiry', rows, patch.expiresAt)).then((done) => {
          if (done) onClose();
        });
      }}
      onCancel={() => {
        ask.clearError();
        onClose();
      }}
    >
      <FieldGrid>
        <TextField
          label={copy.expiryField}
          value={typed}
          onChange={(value) => {
            setTyped(value);
            setFault(null);
          }}
          type="date"
          mono
        />
      </FieldGrid>
    </ConfirmDialog>
  );
}
