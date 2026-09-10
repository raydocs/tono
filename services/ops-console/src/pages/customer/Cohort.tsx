import { useMemo, useState } from 'react';
import type { CustomerSummaryDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import type { DataColumn } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { customerApi } from '@/lib/api-customer-actions';
import { nowSec } from '@/lib/clock';
import { extendedExpiry, refreshable, renewable } from '@/lib/customers';
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
 * and a batch where some calls failed keeps the dialog open with that count
 * rather than closing on a half-done job.
 */
export function useCohort(rows: readonly CustomerSummaryDto[], onChanged: () => void) {
  const ask = useAsk(onChanged);
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
          pending={ask.pending}
          onClick={() => ask.ask({
            title: copy.batchRefreshTitle,
            consequence: copy.batchRefreshBody(chosen.length),
            confirm: copy.batchRefresh,
            run: () => refreshCohort(chosen),
          })}
        >
          {copy.batchRefresh}
        </Action>
        <Action
          reason={renewing.length === 0 ? copy.batchRenewNobody : null}
          pending={ask.pending}
          onClick={() => ask.ask({
            title: copy.batchRenewTitle,
            consequence: copy.batchRenewBody(renewing.length),
            confirm: copy.batchRenew,
            run: () => renewCohort(renewing),
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

/**
 * One catalogue refresh per device, for every device that can carry one.
 *
 * The device ids are not on the customer row, so each customer is read first.
 * That is one request per selected person, which is the price of not bringing
 * the old console's fleet-wide device list across: it answered every device of
 * every customer on every page load, and this asks only about the people whose
 * boxes are ticked.
 */
async function refreshCohort(rows: readonly CustomerSummaryDto[]): Promise<void> {
  let done = 0;
  let failed = 0;
  let devices = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      const detail = await opsApi.customer(row.userId);
      const reach = refreshable(detail.devices);
      devices += reach.length;
      await Promise.all(reach.map(
        (device) => customerApi.queueDeviceAction(device.id, 'refresh_catalog'),
      ));
      done += 1;
    } catch {
      failed += 1;
    }
  }));
  if (failed > 0) throw new Error(copy.batchPartly(done, failed));
  if (devices === 0) throw new Error(copy.batchRefreshNoDevices);
}

async function renewCohort(rows: readonly CustomerSummaryDto[]): Promise<void> {
  const at = nowSec();
  let done = 0;
  let failed = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await customerApi.patchUser(row.userId, { expiresAt: extendedExpiry(row.expiresAt, at) });
      done += 1;
    } catch {
      failed += 1;
    }
  }));
  if (failed > 0) throw new Error(copy.batchPartly(done, failed));
}
