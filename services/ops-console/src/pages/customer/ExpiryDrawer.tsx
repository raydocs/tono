import { useEffect, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import { nowSec } from '@/lib/clock';
import { extendedExpiry } from '@/lib/customers';
import { formatDate } from '@/lib/display';
import { fromDateInput, toDateInput } from '@/lib/settings';
import { useAsk } from './ask';
import { FieldGrid, TextField } from '../settings/form';

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
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTyped(toDateInput(expiresAt));
  }, [open, expiresAt]);

  const renewed = extendedExpiry(expiresAt, nowSec());

  function setByHand() {
    const seconds = fromDateInput(typed);
    if (seconds === null) {
      setFault(copy.expiryInvalid);
      return;
    }
    setFault(null);
    ask.ask({
      title: copy.expiryTitle,
      consequence: copy.expirySetBody(email, formatDate(seconds)),
      confirm: copy.expirySet,
      run: () => customerApi.patchUser(userId, { expiresAt: seconds }),
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
        {fault ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{fault}</p>
        ) : null}
        <ActionRow>
          <Action
            primary
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.expiryTitle,
              consequence: copy.expiryRenewBody(email, formatDate(renewed)),
              confirm: copy.expiryRenew,
              run: () => customerApi.patchUser(userId, { expiresAt: renewed }),
            })}
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
