import { useEffect, useState } from 'react';
import type { CustomerBillingDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { CLAUDE_PLAN, customerApi, type UserPatch } from '@/lib/api-customer-actions';
import { formatDate, splitBytes } from '@/lib/display';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { shown } from '@/lib/sources';
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
