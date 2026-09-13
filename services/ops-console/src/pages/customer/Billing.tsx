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
import { formatDate, formatWhenAgo, splitBytes } from '@/lib/display';
import { customerRow, formatCny, monthOf } from '@/lib/ledger';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { shown } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { measured } from '@/components/ops/measured';
import { useAsk, WriteError } from './ask';
import { FieldGrid, FormFooter, SelectField, TextField } from '../settings/form';

type Plan = '' | typeof CLAUDE_PLAN;

const PLANS: readonly Plan[] = ['', CLAUDE_PLAN];

/** The three fields only an operator ever sees, as the hub stores them. */
export type Profile = {
  wechatId: string | null;
  contact: string | null;
  notes: string | null;
};

/** A stored value in a text box: absent and empty are the same empty box. */
function boxed(value: string | null): string {
  return value ?? '';
}

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
 * The handle, the contact and the notes come back on the customer now, so the
 * form is filled in with what is stored rather than warning that a blank means
 * "leave it alone". That warning was true while nothing read them back; with
 * the stored value in the box, a box the operator empties means the field is
 * empty, and saving it clears what was there.
 */
export function Billing({
  userId,
  billing,
  firstConnectedAt,
  profile,
  updatedAt,
  onChanged,
}: {
  userId: string;
  billing: CustomerBillingDto;
  /**
   * The day this customer first got it working, beside the day they were first
   * entitled to. The pair is the whole of "did the money turn into use", and it
   * is quiet on purpose: it never changes again after that first connection.
   */
  firstConnectedAt: number | null;
  profile: Profile;
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
        <Fact
          label={copy.billingFacts.firstConnected}
          measured={measured(
            firstConnectedAt === null
              ? null
              : copy.firstConnectedAt(formatWhenAgo(firstConnectedAt), formatDate(firstConnectedAt)),
            firstConnectedAt,
            copy.sourceWord.telemetry,
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
        profile={profile}
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
  profile,
  onClose,
  onChanged,
}: {
  open: boolean;
  userId: string;
  billing: CustomerBillingDto;
  profile: Profile;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(() => {
    onChanged();
    onClose();
  });
  const [plan, setPlan] = useState<Plan>('');
  const [date, setDate] = useState('');
  const [wechat, setWechat] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlan(billing.plan === CLAUDE_PLAN ? CLAUDE_PLAN : '');
    setDate(toDateInput(billing.expiresAt));
    setWechat(boxed(profile.wechatId));
    setContact(boxed(profile.contact));
    setNotes(boxed(profile.notes));
    setFault(null);
  }, [open, billing.plan, billing.expiresAt, profile.wechatId, profile.contact, profile.notes]);

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
    // Each of the three is sent only when it moved, and an emptied box clears
    // the stored value rather than being read as "no opinion".
    if (wechat.trim() !== boxed(profile.wechatId)) {
      patch.wechatId = wechat.trim() === '' ? null : wechat.trim();
    }
    if (contact.trim() !== boxed(profile.contact)) {
      patch.contact = contact.trim() === '' ? null : contact.trim();
    }
    if (notes.trim() !== boxed(profile.notes)) {
      patch.notes = notes.trim() === '' ? null : notes.trim();
    }
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
            label={copy.wechatField}
            hint={copy.wechatNudge}
            value={wechat}
            onChange={setWechat}
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
