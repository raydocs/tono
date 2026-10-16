import { useEffect, useMemo, useState } from 'react';
import type { NodeSummaryDto } from '@contract';
import { QUOTA_COUNTS, QUOTA_CYCLE_KINDS } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import {
  batchPatch,
  batchProblem,
  BILLING_CHOICES,
  EMPTY_BATCH,
  isActiveNode,
  lacksExpiry,
  lacksQuota,
  registerBatch,
  type BatchForm,
  type BatchResult,
} from '@/lib/node-facts';
import { cn } from '@/lib/utils';
import { FieldGrid, SelectField, TextField } from '../settings/form';

const words = copy.nodesBoard.batch;
const CHOOSE = '';

/**
 * Write the same hand-kept facts to many machines in one go.
 *
 * Only what was filled is sent, to the same profile write the per-machine form
 * uses, one machine at a time. The list ends with a line of how many took and
 * the machines that did not, and what failed stays picked so pressing the
 * button again retries exactly those.
 */
export function BatchProfileDrawer({
  open,
  nodes,
  onClose,
  onChanged,
}: {
  open: boolean;
  nodes: readonly NodeSummaryDto[];
  onClose: () => void;
  /** Called after any write went through, so the list can be read again. */
  onChanged: () => void;
}) {
  const active = useMemo(() => nodes.filter(isActiveNode), [nodes]);
  const missing = useMemo(
    () => active.filter((row) => lacksQuota(row) || lacksExpiry(row)).map((row) => row.name),
    [active],
  );
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [form, setForm] = useState<BatchForm>(EMPTY_BATCH);
  const [pending, setPending] = useState<number | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(missing));
    setForm(EMPTY_BATCH);
    setResult(null);
    setPending(null);
    // Opened afresh each time; the list changing under an open drawer (the
    // read after a save) must not throw the operator's picks away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof BatchForm>(key: K, value: BatchForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggle = (name: string) => setPicked((current) => {
    const next = new Set(current);
    if (!next.delete(name)) next.add(name);
    return next;
  });

  const names = active.filter((row) => picked.has(row.name)).map((row) => row.name);
  const problem = batchProblem(form);
  const reason = names.length === 0 ? words.problems.none : problem === null ? null : words.problems[problem];
  const busy = pending !== null;

  async function save() {
    setResult(null);
    setPending(0);
    const outcome = await registerBatch(names, batchPatch(form), setPending);
    setPending(null);
    setResult(outcome);
    // What failed stays picked; what went through is done.
    setPicked(new Set(outcome.failed.map((row) => row.name)));
    if (outcome.done.length > 0) onChanged();
  }

  return (
    <DetailDrawer open={open} title={words.title} onClose={onClose}>
      <p className="text-body text-[var(--muted-foreground)]">{words.lead}</p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-micro text-[var(--muted-foreground)]">{words.pickLabel}</span>
          <span className="text-micro text-[var(--muted-foreground)]">{words.pickedCount(names.length, active.length)}</span>
          <span className="ml-auto flex gap-3 text-micro">
            <button type="button" className="text-[color:var(--accent-text)] hover:underline" onClick={() => setPicked(new Set(active.map((row) => row.name)))}>
              {words.pickAll}
            </button>
            <button type="button" className="text-[color:var(--accent-text)] hover:underline" onClick={() => setPicked(new Set(missing))}>
              {words.pickMissing}
            </button>
          </span>
        </div>
        <ul className="flex flex-col border-y border-[var(--hairline)]">
          {active.map((row) => (
            <li key={row.name} className="border-b border-[var(--hairline)] last:border-b-0">
              <label className="flex min-h-[36px] items-center gap-2 py-1.5 max-[640px]:min-h-[44px]">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-[var(--accent)]"
                  checked={picked.has(row.name)}
                  disabled={busy}
                  onChange={() => toggle(row.name)}
                />
                <span className="min-w-0 flex-1 truncate text-body">{row.displayName ?? row.name}</span>
                <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
                  {[lacksQuota(row) ? words.rowMissing.quota : null, lacksExpiry(row) ? words.rowMissing.expiry : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <FieldGrid>
        <TextField
          label={words.fields.quota}
          hint={words.hints.quota}
          value={form.quotaGb}
          mono
          onChange={(value) => set('quotaGb', value)}
        />
        <SelectField
          label={copy.nodeQuotaFields.kind}
          value={form.cycleKind}
          options={[CHOOSE, ...QUOTA_CYCLE_KINDS] as const}
          word={(option) => (option === CHOOSE ? words.choose : copy.nodeQuotaKind[option])}
          onChange={(value) => set('cycleKind', value)}
        />
        <TextField
          label={copy.nodeQuotaFields.anchorDay}
          hint={copy.nodeProfileHints.anchorDay}
          value={form.anchorDay}
          mono
          onChange={(value) => set('anchorDay', value)}
        />
        <SelectField
          label={copy.nodeQuotaFields.counts}
          hint={words.hints.overwrite}
          value={form.counts}
          options={[CHOOSE, ...QUOTA_COUNTS] as const}
          word={(option) => (option === CHOOSE ? words.choose : copy.nodeQuotaCounts[option])}
          onChange={(value) => set('counts', value)}
        />
        <SelectField
          label={words.fields.billing}
          value={form.billing}
          options={BILLING_CHOICES}
          word={(option) => (option === '' ? words.billing.none : option === '30' ? words.billing.month : words.billing.year)}
          onChange={(value) => set('billing', value)}
        />
        <TextField
          label={words.fields.expires}
          type="date"
          value={form.expires}
          mono
          onChange={(value) => set('expires', value)}
        />
        <TextField
          label={words.fields.price}
          hint={words.hints.price}
          value={form.price}
          mono
          onChange={(value) => set('price', value)}
        />
        <TextField
          label={words.fields.currency}
          hint={words.hints.currency}
          value={form.currency}
          mono
          onChange={(value) => set('currency', value)}
        />
      </FieldGrid>

      <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-4">
        {busy ? <p className="text-body text-[var(--muted-foreground)]" role="status">{words.progress(pending, names.length)}</p> : null}
        {result ? (
          <div role="status" className={cn('flex flex-col gap-1 text-body', result.failed.length > 0 && 'panel-error rounded-[8px] px-3 py-2')}>
            <p>{words.result(result.done.length, result.failed.length)}</p>
            {result.failed.map((row) => (
              <p key={row.name} className="text-fine">{words.failure(row.name, row.reason)}</p>
            ))}
          </div>
        ) : null}
        <ActionRow>
          <Action primary pending={busy} reason={reason} onClick={() => { void save(); }}>
            {busy ? words.saving : words.save}
          </Action>
          <Action onClick={onClose}>{words.close}</Action>
        </ActionRow>
      </div>
    </DetailDrawer>
  );
}
