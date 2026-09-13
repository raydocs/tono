import { useEffect, useState } from 'react';
import type { NodeDetailDto, ProviderAccountDto, QuotaCounts, QuotaCycleKind } from '@contract';
import { QUOTA_COUNTS, QUOTA_CYCLE_KINDS } from '@contract';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { nodeApi, type NodeProfileInput } from '@/lib/api-node';
import {
  anchorDayOf,
  bytesToGb,
  gbToBytes,
  numberOrNull,
  parseLineTags,
  textOrNull,
} from '@/lib/node-detail';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { useResource } from '@/lib/use-resource';
import { FieldGrid, FormFooter, SelectField, TextField } from '../settings/form';
import { useWrite } from '../settings/use-write';

/**
 * The only place the machine's own facts can be written.
 *
 * Every fact in that block is hand-kept — nothing measures what a machine
 * costs or when the invoice falls due — so until this form existed the block
 * was nine dashes on a machine somebody was paying for every month. The form
 * is a drawer rather than an inline edit because the fields come as a set: a
 * price without its billing period is not half an answer, it is a wrong one.
 *
 * The quota is on the same form rather than beside the gauge because it is
 * the same kind of fact: what the provider sold, not what the meter saw.
 */
type Form = {
  provider: string;
  providerAccountId: string;
  region: string;
  lineTags: string;
  port: string;
  price: string;
  currency: string;
  billingCycle: string;
  renewsAt: string;
  expiresAt: string;
  notes: string;
  quotaOn: boolean;
  quotaGb: string;
  cycleKind: QuotaCycleKind;
  cycleAnchorDay: string;
  counts: QuotaCounts;
};

const ACCOUNT_NONE = '';

function formOf(node: NodeDetailDto): Form {
  const facts = node.facts;
  const quota = node.quota.value;
  return {
    provider: facts.provider ?? '',
    providerAccountId: facts.providerAccountId ?? ACCOUNT_NONE,
    region: facts.region ?? '',
    lineTags: facts.lineTags.join(' · '),
    port: facts.port === null ? '' : String(facts.port),
    price: facts.price === null ? '' : String(facts.price),
    currency: facts.currency ?? '',
    billingCycle: facts.billingCycle === null ? '' : String(facts.billingCycle),
    renewsAt: toDateInput(facts.renewsAt),
    expiresAt: toDateInput(facts.expiresAt),
    notes: facts.notes ?? '',
    quotaOn: quota.quota !== null,
    quotaGb: bytesToGb(quota.quota),
    cycleKind: quota.cycleKind,
    cycleAnchorDay: anchorDayOf(quota.cycleStart),
    counts: quota.counts,
  };
}

/**
 * The whole form travels, including the boxes nobody touched.
 *
 * A cleared box is a real edit — taking the price off a machine that is no
 * longer billed is something an operator does — and a body that only carried
 * the changed keys could not say the difference between "leave it" and "there
 * is none". Every key here is one the Worker accepts; nothing else is sent.
 */
function bodyOf(form: Form): NodeProfileInput {
  return {
    provider: textOrNull(form.provider),
    providerAccountId: form.providerAccountId === ACCOUNT_NONE ? null : form.providerAccountId,
    region: textOrNull(form.region),
    lineTags: parseLineTags(form.lineTags),
    port: numberOrNull(form.port),
    price: numberOrNull(form.price),
    currency: textOrNull(form.currency),
    billingCycle: numberOrNull(form.billingCycle),
    renewsAt: fromDateInput(form.renewsAt),
    expiresAt: fromDateInput(form.expiresAt),
    notes: textOrNull(form.notes),
    quota: form.quotaOn ? {
      quotaBytes: gbToBytes(form.quotaGb) ?? 0,
      cycleKind: form.cycleKind,
      cycleAnchorDay: numberOrNull(form.cycleAnchorDay) ?? 1,
      counts: form.counts,
    } : null,
  };
}

export function NodeProfileDrawer({
  node,
  open,
  onClose,
  onSaved,
}: {
  node: NodeDetailDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(node));
  const write = useWrite(onSaved);
  // Asked for only while the drawer is open: the list belongs to settings, and
  // a closed drawer has no business fetching it on every node page view.
  const accounts = useResource(
    open ? node.name : null,
    (signal) => settingsApi.providerAccounts(signal),
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setForm(formOf(node));
  }, [open, node]);

  async function save() {
    const ok = await write.run(() => nodeApi.saveProfile(node.name, bodyOf(form)));
    if (ok) onClose();
  }

  const rows: ProviderAccountDto[] = accounts.status === 'ready' ? accounts.data.items : [];
  const accountIds = [ACCOUNT_NONE, ...rows.map((row) => row.id)];
  const accountWord = (id: string) => (
    id === ACCOUNT_NONE
      ? copy.nodeProfileAccountNone
      : rows.find((row) => row.id === id)?.label ?? id
  );

  return (
    <DetailDrawer open={open} title={copy.nodeProfileTitle(node.name)} onClose={onClose}>
      <p className="text-body text-[var(--muted-foreground)]">{copy.nodeProfileLead}</p>

      <FieldGrid>
        <TextField
          label={copy.nodeProfileFields.provider}
          value={form.provider}
          onChange={(value) => set('provider', value)}
        />
        <SelectField
          label={copy.nodeProfileFields.account}
          value={form.providerAccountId}
          options={accountIds}
          word={accountWord}
          onChange={(value) => set('providerAccountId', value)}
        />
        <TextField
          label={copy.nodeProfileFields.region}
          value={form.region}
          onChange={(value) => set('region', value)}
        />
        <TextField
          label={copy.nodeProfileFields.tags}
          hint={copy.nodeProfileHints.tags}
          value={form.lineTags}
          onChange={(value) => set('lineTags', value)}
        />
        <TextField
          label={copy.nodeProfileFields.port}
          value={form.port}
          mono
          onChange={(value) => set('port', value)}
        />
        <TextField
          label={copy.nodeProfileFields.price}
          value={form.price}
          mono
          onChange={(value) => set('price', value)}
        />
        <TextField
          label={copy.nodeProfileFields.currency}
          hint={copy.nodeProfileHints.currency}
          value={form.currency}
          mono
          onChange={(value) => set('currency', value)}
        />
        <TextField
          label={copy.nodeProfileFields.cycle}
          hint={copy.nodeProfileHints.cycle}
          value={form.billingCycle}
          mono
          onChange={(value) => set('billingCycle', value)}
        />
        <TextField
          label={copy.nodeProfileFields.renew}
          type="date"
          value={form.renewsAt}
          mono
          onChange={(value) => set('renewsAt', value)}
        />
        <TextField
          label={copy.nodeProfileFields.expires}
          type="date"
          value={form.expiresAt}
          mono
          onChange={(value) => set('expiresAt', value)}
        />
        <TextField
          label={copy.nodeProfileFields.notes}
          value={form.notes}
          onChange={(value) => set('notes', value)}
        />
      </FieldGrid>

      <QuotaFields form={form} set={set} />

      <FormFooter
        pending={write.pending}
        error={write.error}
        onSave={() => { void save(); }}
        onCancel={onClose}
      />
    </DetailDrawer>
  );
}

/**
 * The allowance, and the three things that decide what it means.
 *
 * They are folded behind one yes/no because a machine with no allowance is
 * the common case and four dead boxes under it read as four missing facts.
 */
function QuotaFields({
  form,
  set,
}: {
  form: Form;
  set: <K extends keyof Form>(key: K, value: Form[K]) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-4">
      <SelectField
        label={copy.nodeProfileQuota}
        value={form.quotaOn ? 'on' : 'off'}
        options={['on', 'off']}
        word={(option) => (option === 'on' ? copy.nodeProfileQuotaOn : copy.nodeProfileQuotaOff)}
        onChange={(value) => set('quotaOn', value === 'on')}
      />
      {form.quotaOn ? (
        <FieldGrid>
          <TextField
            label={copy.nodeQuotaFields.bytes}
            hint={copy.nodeProfileHints.quotaBytes}
            value={form.quotaGb}
            mono
            onChange={(value) => set('quotaGb', value)}
          />
          <SelectField
            label={copy.nodeQuotaFields.kind}
            value={form.cycleKind}
            options={QUOTA_CYCLE_KINDS}
            word={(option) => copy.nodeQuotaKind[option]}
            onChange={(value) => set('cycleKind', value)}
          />
          <TextField
            label={copy.nodeQuotaFields.anchorDay}
            hint={copy.nodeProfileHints.anchorDay}
            value={form.cycleAnchorDay}
            mono
            onChange={(value) => set('cycleAnchorDay', value)}
          />
          <SelectField
            label={copy.nodeQuotaFields.counts}
            value={form.counts}
            options={QUOTA_COUNTS}
            word={(option) => copy.nodeQuotaCounts[option]}
            onChange={(value) => set('counts', value)}
          />
        </FieldGrid>
      ) : null}
    </div>
  );
}
