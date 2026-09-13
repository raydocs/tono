import { useEffect, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import {
  ledgerApi,
  LEDGER_CURRENCIES,
  type LedgerCurrency,
} from '@/lib/api-ledger';
import { nowSec } from '@/lib/clock';
import { extendedExpiry } from '@/lib/customers';
import { formatDate } from '@/lib/display';
import { formatAmount, monthOf, parseAmountMinor } from '@/lib/ledger';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { useAsk } from './ask';
import { FieldGrid, SelectField, TextField } from '../settings/form';

/**
 * The three shapes an expiry change actually takes.
 *
 * Renewing is the common one and it is not "today plus thirty days": it counts
 * from whichever is later, today or the date already paid for, so pressing it
 * a fortnight early adds a month rather than removing two weeks. Setting a
 * date by hand is the exception, and clearing it is the answer for the handful
 * of accounts that are not on a clock at all.
 *
 * All three go through the same gate, and each one's sentence carries the date
 * that will be stored — a renewal that says "renews for 30 days" is not
 * checkable, and one that says the exact day is.
 *
 * A renewal is almost always money arriving, so the drawer offers to write
 * that down in the same breath — unticked, because an offer that defaults to
 * yes turns a date change into an invented payment. The two writes stay in
 * that order and stay separate: the expiry lands first and stands on its own,
 * and an entry that will not save says so instead of taking the renewal down
 * with it. Clearing a date is not a payment and is not offered the box.
 */
export function ExpiryDrawer({
  open,
  email,
  userId,
  expiresAt,
  onClose,
  onChanged,
}: {
  open: boolean;
  email: string;
  userId: string;
  expiresAt: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(() => {
    onChanged();
    onClose();
  });
  const [typed, setTyped] = useState('');
  const [logging, setLogging] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<LedgerCurrency>('CNY');
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTyped(toDateInput(expiresAt));
    setLogging(false);
    setAmount('');
    setCurrency('CNY');
    setFault(null);
  }, [open, expiresAt]);

  const renewed = extendedExpiry(expiresAt, nowSec());
  const amountMinor = parseAmountMinor(amount, currency);

  /**
   * The expiry write, then — only if it landed — the ledger entry. The dialog
   * already said both would happen, so a failure on the second half names
   * itself rather than reading as a renewal that did not take.
   */
  function withEntry(run: () => Promise<unknown>): () => Promise<unknown> {
    if (!logging || amountMinor === null) return run;
    return async () => {
      await run();
      try {
        await ledgerApi.create({
          kind: 'revenue',
          category: 'plan',
          subjectType: 'user',
          subjectId: userId,
          amountMinor,
          currency,
          month: monthOf(nowSec()),
          paidAt: nowSec(),
          note: null,
        });
      } catch (error) {
        throw new Error(copy.ledger.alsoLogFailed(
          error instanceof Error ? error.message : copy.actionFailed,
        ));
      }
    };
  }

  /** The renewal sentence, plus the entry when one is about to be written. */
  function saying(sentence: string): string {
    if (!logging || amountMinor === null) return sentence;
    return `${sentence} ${copy.ledger.alsoLogAlso(formatAmount(amountMinor, currency) ?? '')}`;
  }

  /** Neither renewal runs on a ticked box with nothing typed in it. */
  function guard(): boolean {
    if (logging && amountMinor === null) {
      setFault(copy.ledger.amountInvalid);
      return false;
    }
    setFault(null);
    return true;
  }

  function setByHand() {
    const seconds = fromDateInput(typed);
    if (seconds === null) {
      setFault(copy.expiryInvalid);
      return;
    }
    if (!guard()) return;
    ask.ask({
      title: copy.expiryTitle,
      consequence: saying(copy.expirySetBody(email, formatDate(seconds))),
      confirm: copy.expirySet,
      run: withEntry(() => customerApi.patchUser(userId, { expiresAt: seconds })),
    });
  }

  return (
    <>
      <DetailDrawer open={open} title={copy.expiryTitle} onClose={onClose}>
        <p className="text-body text-[var(--muted-foreground)]">{copy.expiryLead}</p>
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

        <div className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-4">
          <label className="flex items-baseline gap-2">
            <input
              type="checkbox"
              className="translate-y-[2px]"
              checked={logging}
              onChange={(event) => {
                setLogging(event.target.checked);
                setFault(null);
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-body">{copy.ledger.alsoLog}</span>
              <span className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
                {copy.ledger.alsoLogHint}
              </span>
            </span>
          </label>
          {logging ? (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <TextField
                label={copy.ledger.fieldAmount}
                value={amount}
                onChange={(value) => {
                  setAmount(value);
                  setFault(null);
                }}
                mono
              />
              <SelectField
                label={copy.ledger.fieldCurrency}
                value={currency}
                options={LEDGER_CURRENCIES}
                word={(option) => option}
                onChange={setCurrency}
              />
            </div>
          ) : null}
        </div>

        {fault ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{fault}</p>
        ) : null}
        <ActionRow>
          <Action
            primary
            pending={ask.pending}
            onClick={() => {
              if (!guard()) return;
              ask.ask({
                title: copy.expiryTitle,
                consequence: saying(copy.expiryRenewBody(email, formatDate(renewed))),
                confirm: copy.expiryRenew,
                run: withEntry(() => customerApi.patchUser(userId, { expiresAt: renewed })),
              });
            }}
          >
            {copy.expiryRenew}
          </Action>
          <Action pending={ask.pending} onClick={setByHand}>{copy.expirySet}</Action>
          <Action
            reason={expiresAt === null ? copy.expiryAlreadyClear : null}
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.expiryTitle,
              consequence: copy.expiryClearBody(email),
              confirm: copy.expiryClear,
              run: () => customerApi.patchUser(userId, { expiresAt: null }),
            })}
          >
            {copy.expiryClear}
          </Action>
        </ActionRow>
      </DetailDrawer>
      {ask.dialog}
    </>
  );
}
