import { useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { CLAUDE_PLAN, customerApi, type OnboardInput } from '@/lib/api-customer-actions';
import { fromDateInput } from '@/lib/settings';
import { hubApi } from '@/lib/settings-legacy';
import { usePrivacy } from '@/lib/privacy';
import { useResource } from '@/lib/use-resource';
import type { OnboardOutcome } from '@/lib/customers-legacy';
import { useAsk } from './ask';
import { FieldGrid, SelectField, TextField } from '../settings/form';

type Plan = '' | typeof CLAUDE_PLAN;

const PLANS: readonly Plan[] = ['', CLAUDE_PLAN];

type Draft = {
  email: string;
  plan: Plan;
  expiresAt: string;
  line: string;
  homeExitId: string;
  accountRef: string;
  productAccountId: string;
  notes: string;
  contact: string;
};

const BLANK: Draft = {
  email: '',
  plan: '',
  expiresAt: '',
  line: '',
  homeExitId: '',
  accountRef: '',
  productAccountId: '',
  notes: '',
  contact: '',
};

/**
 * Onboarding, in the two steps the hub actually has.
 *
 * The first call adds the address to the sign-up list. Everything else — the
 * exit identity, the home line, the Claude account — needs a customer record,
 * and there is no customer record until the person has logged in from the
 * client with that address. So the drawer does not claim a finished
 * onboarding: it shows the hub's own list of what is done and what is still
 * waiting, and offers the same form again for after the login.
 *
 * The plan and the expiry are a second call, because `users/onboard` does not
 * accept them. They are on this form anyway: an operator setting a customer up
 * is thinking about what they are paying for, and making them find the detail
 * page afterwards is how accounts end up with no expiry at all.
 */
export function OnboardDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onSaved);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [outcome, setOutcome] = useState<OnboardOutcome | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  const exits = useResource(open ? 'home-exits' : null, (signal) => hubApi.homeExits(signal));
  const pool = useResource(open ? 'pooled' : null, (signal) => customerApi.pooledAccounts(signal));

  const idle = (exits.status === 'ready' ? exits.data : []).filter(
    (row) => row.status === 'active' && (row.bindCount ?? 0) === 0,
  );
  const pooled = pool.status === 'ready' ? pool.data : [];

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFault(null);
  }

  function shut() {
    setDraft(BLANK);
    setOutcome(null);
    setFault(null);
    ask.clearError();
    onClose();
  }

  async function run(): Promise<void> {
    const input: OnboardInput = { email: draft.email.trim() };
    if (draft.line.trim() !== '') input.line = draft.line.trim();
    else if (draft.homeExitId !== '') input.homeExitId = draft.homeExitId;
    if (draft.accountRef.trim() !== '') input.accountRef = draft.accountRef.trim();
    else if (draft.productAccountId !== '') input.productAccountId = draft.productAccountId;
    if (draft.notes.trim() !== '') input.notes = draft.notes.trim();
    if (draft.contact.trim() !== '') input.contact = draft.contact.trim();
    const answer = await customerApi.onboard(input);
    setOutcome(answer);
    if (answer.userId === null) return;
    const expiresAt = draft.expiresAt.trim() === '' ? null : fromDateInput(draft.expiresAt);
    const wantsPlan = draft.plan !== '';
    if (expiresAt === null && !wantsPlan) return;
    await customerApi.patchUser(answer.userId, {
      ...(wantsPlan ? { plan: draft.plan } : {}),
      ...(expiresAt === null ? {} : { expiresAt }),
    });
  }

  function submit() {
    const email = draft.email.trim();
    if (!email.includes('@')) {
      setFault(copy.settings.required);
      return;
    }
    if (draft.expiresAt.trim() !== '' && fromDateInput(draft.expiresAt) === null) {
      setFault(copy.expiryInvalid);
      return;
    }
    setFault(null);
    ask.ask({
      title: copy.onboardTitle,
      consequence: copy.onboardConfirmBody(privacy.email(email)),
      confirm: copy.onboardSave,
      run,
    });
  }

  const waiting = outcome !== null && outcome.userId === null;

  return (
    <>
      <DetailDrawer
        open={open}
        title={copy.onboardTitle}
        onClose={shut}
        footer={(
          <ActionRow>
            <Action primary pending={ask.pending} onClick={submit}>
              {waiting ? copy.onboardAgain : copy.onboardSave}
            </Action>
            <Action onClick={shut}>{copy.settings.cancel}</Action>
          </ActionRow>
        )}
      >
        <p className="text-body text-[var(--muted-foreground)]">{copy.onboardLead}</p>

        <FieldGrid>
          <TextField
            label={copy.onboardFields.email}
            hint={copy.onboardHints.email}
            value={draft.email}
            onChange={(value) => {
              set('email', value);
              setOutcome(null);
            }}
          />
          <SelectField
            label={copy.onboardFields.plan}
            value={draft.plan}
            options={PLANS}
            word={(option) => (option === '' ? copy.onboardPlanNone : copy.serviceName.claude)}
            onChange={(value) => set('plan', value)}
          />
          <TextField
            label={copy.onboardFields.expiresAt}
            hint={copy.onboardHints.expiresAt}
            value={draft.expiresAt}
            onChange={(value) => set('expiresAt', value)}
            type="date"
            mono
          />
          <TextField
            label={copy.onboardFields.line}
            hint={copy.onboardHints.line}
            value={draft.line}
            onChange={(value) => {
              set('line', value);
              if (value !== '') set('homeExitId', '');
            }}
            mono
          />
          <SelectField
            label={copy.onboardFields.homeExit}
            value={draft.homeExitId}
            options={['', ...idle.map((row) => row.id)]}
            word={(id) => {
              if (id === '') {
                return exits.status !== 'ready'
                  ? copy.onboardPick.notReady
                  : idle.length === 0 ? copy.onboardPick.homesEmpty : copy.onboardPick.none;
              }
              const row = idle.find((entry) => entry.id === id);
              return row === undefined
                ? id
                : `${row.displayName} · ${privacy.ip(row.socks5Host ?? row.egressIpv4)}`;
            }}
            onChange={(value) => {
              set('homeExitId', value);
              if (value !== '') set('line', '');
            }}
          />
          <TextField
            label={copy.onboardFields.accountRef}
            hint={copy.onboardHints.accountRef}
            value={draft.accountRef}
            onChange={(value) => {
              set('accountRef', value);
              if (value !== '') set('productAccountId', '');
            }}
            mono
          />
          <SelectField
            label={copy.onboardFields.pooled}
            value={draft.productAccountId}
            options={['', ...pooled.map((row) => row.id)]}
            word={(id) => {
              if (id === '') {
                return pool.status !== 'ready'
                  ? copy.onboardPick.notReady
                  : pooled.length === 0 ? copy.onboardPick.poolEmpty : copy.onboardPick.none;
              }
              const row = pooled.find((entry) => entry.id === id);
              return row === undefined ? id : privacy.secret(row.accountRef);
            }}
            onChange={(value) => {
              set('productAccountId', value);
              if (value !== '') set('accountRef', '');
            }}
          />
          <TextField
            label={copy.onboardFields.contact}
            hint={copy.billingContactHint}
            value={draft.contact}
            onChange={(value) => set('contact', value)}
          />
          <TextField
            label={copy.onboardFields.notes}
            value={draft.notes}
            onChange={(value) => set('notes', value)}
          />
        </FieldGrid>

        {fault === null ? null : (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{fault}</p>
        )}

        {outcome === null ? null : <Checklist outcome={outcome} />}
      </DetailDrawer>
      {ask.dialog}
    </>
  );
}

/** What the hub managed, and what it is still waiting on the customer for. */
function Checklist({ outcome }: { outcome: OnboardOutcome }) {
  const privacy = usePrivacy();
  const registered = outcome.userId !== null;
  const steps: Array<{ done: boolean; word: string }> = [
    { done: outcome.allowlisted, word: copy.onboardSteps.allowlisted },
    {
      done: registered,
      word: registered ? copy.onboardSteps.registered : copy.onboardStepWaiting.registered,
    },
    {
      done: outcome.exitIdentityIssued,
      word: outcome.exitIdentityIssued
        ? copy.onboardSteps.identity
        : copy.onboardStepWaiting.identity,
    },
    {
      done: outcome.boundHome,
      word: outcome.boundHome ? copy.onboardSteps.home : copy.onboardStepWaiting.home,
    },
    {
      done: outcome.hasAccount,
      word: outcome.hasAccount ? copy.onboardSteps.claude : copy.onboardStepWaiting.claude,
    },
  ];
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-4">
      <p className="text-row">{privacy.email(outcome.email)}</p>
      <ul className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <li key={step.word} className="flex items-baseline gap-2 text-body">
            {step.done
              ? <Check size={12} strokeWidth={2} className="translate-y-[1px] shrink-0" />
              : <Circle size={12} strokeWidth={1.75} className="translate-y-[1px] shrink-0 text-[var(--muted-foreground)]" />}
            <span className={step.done ? undefined : 'text-[var(--muted-foreground)]'}>{step.word}</span>
          </li>
        ))}
      </ul>
      {!registered ? (
        <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
          {copy.onboardExtrasIgnored}
        </p>
      ) : null}
    </div>
  );
}
