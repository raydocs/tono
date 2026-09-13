import { useEffect, useMemo, useState } from 'react';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { refusalCode } from '@/lib/api-customer-actions';
import {
  FX_RATE_MISSING,
  LEDGER_CATEGORIES,
  LEDGER_CURRENCIES,
  LEDGER_KINDS,
  VALIDATION_ERROR,
  ledgerApi,
  type LedgerCategory,
  type LedgerCurrency,
  type LedgerKind,
} from '@/lib/api-ledger';
import { settingsApi } from '@/lib/api-settings';
import { nowSec } from '@/lib/clock';
import {
  currencyFor,
  currencyLocked,
  dayOf,
  formatCny,
  formatRate,
  fxIsStale,
  monthChoices,
  monthWords,
  parseAmountMinor,
  subjectTypeFor,
  toCnyMinor,
} from '@/lib/ledger';
import { fromDateInput } from '@/lib/settings';
import { useResource } from '@/lib/use-resource';
import { FieldGrid, FormFooter, SelectField, TextField } from './form';

const words = copy.ledger;

type Choice = { id: string; label: string };

/**
 * One entry, typed in.
 *
 * The category picks what the entry can be about — a plan is billed to a
 * customer, a server to a machine — so the subject list is fetched from
 * whichever inventory the category names rather than typed as a free string.
 * An id typed by hand is an id that quietly attaches half a month's cost to a
 * machine that was renamed a fortnight ago.
 *
 * Money in a foreign currency is shown converted *before* it is saved, with
 * the day and the rate that did it. The Worker converts again on the way in
 * and its answer is the one that is stored — this is a preview, not a second
 * source of truth — but an operator about to write down 128 USD deserves to
 * see the ¥912 it is going to become while they can still change their mind.
 *
 * Which currencies are on offer is the kind's business, not the operator's:
 * money coming in is only ever yuan, so those three kinds lock the field and
 * say why, and a bill opens on dollars because that is what the invoices are
 * in. `lib/ledger.ts` holds the rule and the test; the field only renders it.
 */
export function LedgerDrawer({
  open,
  month,
  onClose,
  onSaved,
}: {
  open: boolean;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<LedgerKind>('revenue');
  const [category, setCategory] = useState<LedgerCategory>('plan');
  const [subject, setSubject] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<LedgerCurrency>('CNY');
  const [into, setInto] = useState(month);
  const [paid, setPaid] = useState(dayOf(nowSec()));
  const [note, setNote] = useState('');
  const [fault, setFault] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind('revenue');
    setCategory('plan');
    setSubject('');
    setAmount('');
    setCurrency('CNY');
    setInto(month);
    setPaid(dayOf(nowSec()));
    setNote('');
    setFault(null);
  }, [open, month]);

  const subjectType = subjectTypeFor(category);
  const choices = useSubjects(open, subjectType);
  const amountMinor = parseAmountMinor(amount, currency);
  const rate = useRate(open, currency, paid);

  return (
    <DetailDrawer open={open} title={words.entryTitle} onClose={onClose}>
      <FieldGrid>
        <SelectField
          label={words.fieldKind}
          value={kind}
          options={LEDGER_KINDS}
          word={(option) => words.kind[option]}
          onChange={(next) => {
            setKind(next);
            setCurrency((held) => currencyFor(next, held));
          }}
        />
        <SelectField
          label={words.fieldCategory}
          value={category}
          options={LEDGER_CATEGORIES}
          word={(option) => words.category[option]}
          onChange={(next) => {
            setCategory(next);
            setSubject('');
          }}
        />
        {subjectType === 'fleet' ? (
          <FleetSubject />
        ) : (
          <SelectField
            label={words.fieldSubject}
            hint={words.subjectHint[subjectType]}
            value={subject}
            options={['', ...choices.map((row) => row.id)]}
            word={(option) => (option === ''
              ? (choices.length === 0 ? words.subjectNone : words.subjectPick)
              : choices.find((row) => row.id === option)?.label ?? option)}
            onChange={setSubject}
          />
        )}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <TextField
            label={words.fieldAmount}
            hint={words.amountHint}
            value={amount}
            onChange={setAmount}
            mono
          />
          <SelectField
            label={words.fieldCurrency}
            hint={currencyLocked(kind) ? words.currencyCny : undefined}
            value={currency}
            options={LEDGER_CURRENCIES}
            word={(option) => option}
            disabled={currencyLocked(kind)}
            onChange={setCurrency}
          />
        </div>
        <SelectField
          label={words.fieldMonth}
          hint={words.monthHint}
          value={into}
          options={monthChoices(nowSec())}
          word={monthWords}
          onChange={setInto}
        />
        <TextField
          label={words.fieldPaidAt}
          hint={words.paidHint}
          value={paid}
          onChange={setPaid}
          type="date"
          mono
        />
        <TextField label={words.fieldNote} value={note} onChange={setNote} />
      </FieldGrid>

      <FxLine state={rate} currency={currency} amountMinor={amountMinor} day={paid} />

      <FormFooter
        pending={pending}
        error={fault}
        onCancel={onClose}
        onSave={() => {
          if (amountMinor === null) {
            setFault(words.amountInvalid);
            return;
          }
          if (subjectType !== 'fleet' && subject === '') {
            setFault(copy.settings.required);
            return;
          }
          setFault(null);
          setPending(true);
          void ledgerApi.create({
            kind,
            category,
            subjectType,
            subjectId: subjectType === 'fleet' ? null : subject,
            amountMinor,
            currency,
            month: into,
            paidAt: fromDateInput(paid),
            note: note.trim() === '' ? null : note.trim(),
          }).then(
            () => {
              setPending(false);
              onSaved();
              onClose();
            },
            (error: unknown) => {
              setPending(false);
              const code = refusalCode(error);
              if (code === FX_RATE_MISSING) {
                setFault(words.fxMissing(paid));
                return;
              }
              // The hub turning down the currency says the same thing the
              // locked field says, in the same words.
              if (code === VALIDATION_ERROR && currencyLocked(kind)) {
                setFault(words.currencyCny);
                return;
              }
              setFault(error instanceof Error ? error.message : copy.actionFailed);
            },
          );
        }}
      />
    </DetailDrawer>
  );
}

/** The one subject that is not a row in an inventory: the fleet's own bills. */
function FleetSubject() {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{words.fieldSubject}</span>
      <span className="text-body">{words.subjectFleet}</span>
      <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        {words.subjectHint.fleet}
      </span>
    </label>
  );
}

/**
 * Whichever inventory the category is billed against, fetched only once the
 * drawer is open and only for the list the current category needs.
 */
function useSubjects(open: boolean, subjectType: string): Choice[] {
  const key = open ? subjectType : null;
  const customers = useResource(key === 'user' ? key : null, (signal) => opsApi.customers(signal));
  const nodes = useResource(key === 'node' ? key : null, (signal) => opsApi.nodes(signal));
  const lines = useResource(key === 'home_exit' ? key : null, (signal) => settingsApi.homeLines(signal));
  const accounts = useResource(key === 'account' ? key : null, (signal) => ledgerApi.productAccounts(signal));

  return useMemo(() => {
    if (subjectType === 'user' && customers.status === 'ready') {
      return customers.data.items.map((row) => ({ id: row.userId, label: row.email }));
    }
    if (subjectType === 'node' && nodes.status === 'ready') {
      return nodes.data.items.map((row) => ({ id: row.name, label: row.name }));
    }
    if (subjectType === 'home_exit' && lines.status === 'ready') {
      return lines.data.items.map((row) => ({ id: row.id, label: row.displayName }));
    }
    if (subjectType === 'account' && accounts.status === 'ready') {
      return accounts.data.map((row) => ({ id: row.id, label: row.accountRef }));
    }
    return [];
  }, [subjectType, customers, nodes, lines, accounts]);
}

type RateState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; day: string; rate: number };

/** The day's rate for the currency being typed in, or the reason there is none. */
function useRate(open: boolean, currency: string, day: string): RateState {
  const needed = open && currency !== 'CNY' && fromDateInput(day) !== null;
  const rate = useResource(
    needed ? `${day}|${currency}` : null,
    (signal) => ledgerApi.fx(day, currency, signal),
  );
  if (!needed) return { status: 'none' };
  if (rate.status === 'loading') return { status: 'loading' };
  if (rate.status === 'error') return { status: 'missing' };
  return { status: 'ready', day: rate.data.day, rate: rate.data.rate };
}

/**
 * What this money is in yuan, and on whose authority.
 *
 * The line names the day the rate is from rather than "today", because the
 * rates are pulled once a day and an entry written before the pull is
 * converted at yesterday's — true, usable, and something the operator has to
 * be told rather than left to discover when the month does not add up.
 */
function FxLine({
  state,
  currency,
  amountMinor,
  day,
}: {
  state: RateState;
  currency: string;
  amountMinor: number | null;
  day: string;
}) {
  if (state.status === 'none') return null;
  if (state.status === 'loading') {
    return <p className="text-body text-[var(--muted-foreground)]">{words.fxLoading}</p>;
  }
  if (state.status === 'missing') {
    return <p className="panel-error rounded-[8px] px-3 py-2 text-body">{words.fxMissing(day)}</p>;
  }
  const cny = amountMinor === null ? null : toCnyMinor(amountMinor, currency, state.rate);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body">
        {words.fxLine(state.day, formatRate(state.rate), formatCny(cny) ?? copy.missing)}
      </p>
      {fxIsStale(day, state.day) ? (
        <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
          {words.fxStale(day, state.day)}
        </p>
      ) : null}
    </div>
  );
}
