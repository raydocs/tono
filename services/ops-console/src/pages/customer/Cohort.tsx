import { useMemo, useState, useSyncExternalStore } from 'react';
import type { CustomerSummaryDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import type { DataColumn } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import { batchCopy } from '@/copy/batch';
import { batchSnapshot, startBatch, subscribeBatch } from '@/lib/customer-batch';
import { renewable } from '@/lib/customers';
import { useAsk } from './ask';

/**
 * Picking several customers, and the two things worth doing to all of them.
 *
 * Both were on the old console's list page and both are the reason an
 * operator opened it: a catalogue that moved leaves a cohort of clients on
 * the old one, and renewals arrive in batches at the start of a month.
 *
 * Neither is a loop the page hides. The confirmation says how many people are
 * about to be touched, the run reports how many of them it actually managed,
 * and per-object results remain outside the confirmation after it finishes.
 */
export function useCohort(rows: readonly CustomerSummaryDto[], onChanged: () => void) {
  const ask = useAsk(onChanged);
  const batch = useSyncExternalStore(subscribeBatch, batchSnapshot);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const chosen = useMemo(
    () => rows.filter((row) => picked.has(row.userId)),
    [rows, picked],
  );

  function toggle(userId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const column: DataColumn<CustomerSummaryDto> = {
    id: 'pick',
    header: '',
    // Narrower padding than the rest: this column is one 14 px control, and
    // every pixel it takes comes out of the address beside it.
    width: '30px',
    className: 'px-2',
    cell: (row) => (
      <input
        type="checkbox"
        aria-label={copy.selectRow}
        className="size-3.5 accent-[var(--accent)] align-middle"
        checked={picked.has(row.userId)}
        onClick={(event) => event.stopPropagation()}
        onChange={() => toggle(row.userId)}
      />
    ),
  };

  const renewing = renewable(chosen);

  const bar = chosen.length === 0 ? null : (
    <div className="toolbar-row items-center">
      <span className="text-body">{copy.selectedCount(chosen.length)}</span>
      <ActionRow className="ml-auto">
        <Action
          pending={ask.pending || batch.busy}
          reason={batch.kind !== null ? batchCopy.previous : null}
          onClick={() => ask.ask({
            title: copy.batchRefreshTitle,
            consequence: copy.batchRefreshBody(chosen.length),
            confirm: copy.batchRefresh,
            run: () => startBatch('refresh', chosen),
          })}
        >
          {copy.batchRefresh}
        </Action>
        <Action
          reason={batch.kind !== null ? batchCopy.previous : renewing.length === 0 ? copy.batchRenewNobody : null}
          pending={ask.pending || batch.busy}
          onClick={() => ask.ask({
            title: copy.batchRenewTitle,
            consequence: copy.batchRenewBody(renewing.length),
            confirm: copy.batchRenew,
            run: () => startBatch('renew', renewing),
          })}
        >
          {copy.batchRenew}
        </Action>
        <Action onClick={() => setPicked(new Set())}>{copy.clearSelection}</Action>
      </ActionRow>
    </div>
  );

  return { column, bar, dialog: ask.dialog };
}
