import { useEffect, useState } from 'react';
import type { CustomerBillingDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { CLAUDE_PLAN, customerApi, type UserPatch } from '@/lib/api-customer-actions';
import { ledgerApi } from '@/lib/api-ledger';
import { nowSec } from '@/lib/clock';
import { formatDate, splitBytes } from '@/lib/display';
import { customerRow, formatCny, monthOf } from '@/lib/ledger';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { shown } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { measured } from '@/components/ops/measured';
import { useAsk, WriteError } from './ask';
import { FieldGrid, FormFooter, SelectField, TextField } from '../settings/form';

type Plan = '' | typeof CLAUDE_PLAN;

const PLANS: readonly Plan[] = ['', CLAUDE_PLAN];

/**
 * What the customer is on, until when, and the one number that can be ended.
 *
 * The block was four read-only facts. It keeps them — the same four, in the
 * same order — and gains the two writes that used to mean opening the old
 * console: the plan and the date, and ending the billing cycle.
 *
 * Ending a cycle is not editing a number. The collector re-sends a cumulative
 * fleet total every ten minutes and the hub takes the maximum, so zeroing the
 * counter alone is undone within ten minutes; what the hub actually does is
 * move the baseline up to the reported figure. The sentence in front of the
 * button says so, because "clear" reads like an undo and this is not one.
 *
 * Contact and notes are write-only here, and the form says so. No read this
 * console is allowed to make returns them — the customer contract carries the
 * facts about connectivity, not the operator's own notes — so a field
 * pre-filled with nothing would be claiming the stored value is empty.
 */
export function Billing({
  userId,
  billing,
  updatedAt,
  onChanged,
}: {
  userId: string;
  billing: CustomerBillingDto;
  updatedAt: number;
  onChanged: () => void;
}) {
  const ask = useAsk(onChanged);
  const [editing, setEditing] = useState(false);
  const usage = shown(billing.usageBytes);
  const used = usage.value === null ? null : splitBytes(usage.value);

  return (
    <FoldedSection title={copy.customerSections.billing}>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <Fact
          label={copy.billingFacts.plan}
          measured={measured(billing.plan, updatedAt, copy.sourceWord.profile)}
        />
        <Fact
          label={copy.billingFacts.deviceLimit}
          measured={measured(String(billing.deviceLimit), updatedAt, copy.sourceWord.profile)}
        />
        <Fact
          label={copy.billingFacts.since}
          measured={measured(
            billing.firstEntitledAt === null ? null : formatDate(billing.firstEntitledAt),
            billing.firstEntitledAt,
            copy.sourceWord.profile,
          )}
        />
        <Fact
          label={copy.billingFacts.expires}
          measured={measured(
            billing.expiresAt === null ? null : formatDate(billing.expiresAt),
            billing.expiresAt,
            copy.sourceWord.profile,
          )}
        />
      </div>

      <LedgerFacts userId={userId} />

      <WriteError message={ask.error} />

      <ActionRow>
        <Action onClick={() => setEditing(true)}>{copy.billingEdit}</Action>
        <Action
          reason={used === null || usage.value === 0 ? copy.resetUsageNothing : null}
          pending={ask.pending}
          onClick={() => ask.ask({
            title: copy.resetUsageTitle,
            consequence: copy.resetUsageBody(used === null ? copy.missing : `${used.number} ${used.unit}`),
            confirm: copy.resetUsageConfirm,
            run: () => customerApi.patchUser(userId, { resetUsage: true }),
          })}
        >
          {copy.resetUsage}
        </Action>
      </ActionRow>

      {ask.dialog}

      <BillingDrawer
        open={editing}
        userId={userId}
        billing={billing}
        onClose={() => setEditing(false)}
        onChanged={onChanged}
      />
    </FoldedSection>
  );
}

/**
 * This month's money for this one customer: what they paid, what they cost,
 * and the difference — or the word for a difference nobody can compute.
 *
 * The cost side is an allocation, not an invoice: it is this customer's share
 * of the machines they sat on. When one of those machines has not been
 * reconciled for the month, the share is a guess, so the margin says so in
 * words and no number is printed. It reads off the same month summary the
 * ledger page shows, so the two surfaces cannot disagree, and a customer with
 * nothing on the month's ledger says exactly that rather than three zeroes.
 */
function LedgerFacts({ userId }: { userId: string }) {
  const month = monthOf(nowSec());
  const summary = useResource(`ledger-month-${month}`, (signal) => ledgerApi.month(month, signal));
  if (summary.status !== 'ready') {
    return (
      <EmptyLine message={summary.status === 'error' ? summary.message : copy.loading} />
    );
  }
  const row = customerRow(summary.data, userId);
  if (row === null) return <EmptyLine message={copy.ledger.customerNone} />;
  const at = summary.data.updatedAt;
  const say = (value: string | null) => measured(value, at, copy.ledger.source);
  return (
    <div className="grid gap-x-8 sm:grid-cols-3">
      <Fact label={copy.ledger.customerRevenue} measured={say(formatCny(row.revenueCnyMinor))} />
      <Fact label={copy.ledger.customerCost} measured={say(formatCny(row.costCnyMinor))} />
      <Fact
        label={copy.ledger.customerMargin}
        measured={say(row.marginCnyMinor === null
          ? copy.ledger.pending
          : formatCny(row.marginCnyMinor))}
      />
    </div>
  );
}

function BillingDrawer({
  open,
  userId,
  billing,
  onClose,
  onChanged,
}: {
  open: boolean;
  userId: string;
  billing: CustomerBillingDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(() => {
    onChanged();
    onClose();
  });
  const [plan, setPlan] = useState<Plan>('');
  const [date, setDate] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlan(billing.plan === CLAUDE_PLAN ? CLAUDE_PLAN : '');
    setDate(toDateInput(billing.expiresAt));
    setContact('');
    setNotes('');
    setFault(null);
  }, [open, billing.plan, billing.expiresAt]);

  function save() {
    const patch: UserPatch = {};
    if (plan !== (billing.plan === CLAUDE_PLAN ? CLAUDE_PLAN : '')) {
      patch.plan = plan === '' ? null : plan;
    }
    const current = toDateInput(billing.expiresAt);
    if (date !== current) {
      if (date.trim() === '') {
        patch.expiresAt = null;
      } else {
        const seconds = fromDateInput(date);
        if (seconds === null) {
          setFault(copy.expiryInvalid);
          return;
        }
        patch.expiresAt = seconds;
      }
    }
    if (contact.trim() !== '') patch.contact = contact.trim();
    if (notes.trim() !== '') patch.notes = notes.trim();
    const changing = Object.keys(patch) as Array<keyof UserPatch>;
    if (changing.length === 0) {
      setFault(copy.settings.savedNothing);
      return;
    }
    setFault(null);
    // The plan and the date are what the customer is paying for, so they go
    // through the same gate as everything else here rather than saving on a
    // click; the sentence names the fields that are about to move.
    ask.ask({
      title: copy.billingEdit,
      consequence: copy.billingSaveBody(copy.billingChangeList(
        changing.map((key) => copy.billingChangeWord[key as keyof typeof copy.billingChangeWord] ?? key),
      )),
      confirm: copy.settings.save,
      run: () => customerApi.patchUser(userId, patch),
    });
  }

  return (
    <>
      <DetailDrawer open={open} title={copy.billingEdit} onClose={onClose}>
        <p className="text-body text-[var(--muted-foreground)]">{copy.billingWriteOnly}</p>
        <FieldGrid>
          <SelectField
            label={copy.billingFieldPlan}
            hint={copy.billingPlanHint}
            value={plan}
            options={PLANS}
            word={(option) => (option === '' ? copy.onboardPlanNone : copy.serviceName.claude)}
            onChange={setPlan}
          />
          <TextField
            label={copy.billingFieldExpires}
            hint={copy.onboardHints.expiresAt}
            value={date}
            onChange={setDate}
            type="date"
            mono
          />
          <TextField
            label={copy.billingFieldContact}
            hint={copy.billingContactHint}
            value={contact}
            onChange={setContact}
          />
          <TextField label={copy.billingFieldNotes} value={notes} onChange={setNotes} />
        </FieldGrid>
        <FormFooter
          pending={ask.pending}
          error={fault ?? ask.error}
          onSave={save}
          onCancel={onClose}
        />
      </DetailDrawer>
      {ask.dialog}
    </>
  );
}
