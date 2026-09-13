import { useState } from 'react';
import type { CustomerDetailDto, CustomerDeviceDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import { followupApi } from '@/lib/api-followups';
import { actionsFor, refreshable } from '@/lib/customers';
import { usePrivacy } from '@/lib/privacy';
import { useAsk } from './ask';
import { ExpiryDrawer } from './ExpiryDrawer';
import { SelectField, TextField } from '../settings/form';

/**
 * The four things this page can do to the account, in the header's own row.
 *
 * They were four disabled buttons saying "no endpoint" for as long as the
 * console has existed; every one of them has had an endpoint the whole time.
 * What changes here is only that the buttons now reach it — and that each one
 * first says what the customer will feel:
 *
 *  - The diagnostic queues one snapshot on one named device. It is queued, not
 *    live: the client picks it up on its next check-in, or the request expires.
 *  - Re-sending credentials is a catalogue refresh on every device, because
 *    that is what the old console meant by it — the credentials ride the
 *    catalogue, so re-fetching it is how a device gets a working one.
 *  - The expiry button opens the date drawer rather than renewing on the spot:
 *    renewing is the common case but not the only one, and a button that
 *    silently adds thirty days is how a two-year runway gets shortened.
 *  - Suspension is the tear-down, and it is the one action here that asks for
 *    a reason before it will run.
 */
export function CustomerHeader({
  row,
  onChanged,
}: {
  row: CustomerDetailDto;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onChanged);
  const [diagnosing, setDiagnosing] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [expiry, setExpiry] = useState(false);

  const email = privacy.email(row.email);
  const diagnosable = row.devices.filter((device) => (
    device.status !== 'revoked' && actionsFor(device.platform).includes('diagnostic_snapshot')
  ));
  const catalogue = refreshable(row.devices);
  const closed = row.lifecycle !== 'active';
  const words = copy.customerHeadActions;

  return (
    <>
      <ActionRow>
        <Action
          reason={diagnosable.length === 0 ? copy.noDevices : null}
          onClick={() => setDiagnosing(true)}
        >
          {words.diagnose}
        </Action>
        <Action
          reason={catalogue.length === 0 ? copy.noDevices : null}
          onClick={() => ask.ask({
            title: copy.resendTitle,
            consequence: copy.resendBody(catalogue.length),
            confirm: words.resend,
            /* The record writes itself. An operator who re-sends credentials
               and then has to remember to note it is an operator whose notes
               are missing exactly the actions that mattered. */
            run: async () => {
              await Promise.all(catalogue.map(
                (device) => customerApi.queueDeviceAction(device.id, 'refresh_catalog'),
              ));
              await followupApi.addForCustomer(row.userId, {
                kind: 'reply',
                body: copy.followupAuto.resend,
              });
            },
          })}
        >
          {words.resend}
        </Action>
        <Action onClick={() => setExpiry(true)}>{words.changeExpiry}</Action>
        {closed ? (
          <Action
            primary
            onClick={() => ask.ask({
              title: copy.restoreTitle,
              consequence: copy.restoreBody(email),
              confirm: copy.restoreConfirm,
              run: () => customerApi.patchUser(row.userId, { status: 'active' }),
            })}
          >
            {words.restore}
          </Action>
        ) : (
          <Action onClick={() => setSuspending(true)}>{words.suspend}</Action>
        )}
      </ActionRow>

      {ask.dialog}

      <PickDialog
        open={diagnosing}
        userId={row.userId}
        devices={diagnosable}
        onClose={() => setDiagnosing(false)}
        onChanged={onChanged}
      />

      <SuspendDialog
        open={suspending}
        email={email}
        userId={row.userId}
        onClose={() => setSuspending(false)}
        onChanged={onChanged}
      />

      <ExpiryDrawer
        open={expiry}
        email={email}
        userId={row.userId}
        expiresAt={row.billing.expiresAt}
        onClose={() => setExpiry(false)}
        onChanged={onChanged}
      />
    </>
  );
}

/**
 * The handle the operator actually reaches this customer on, beside the
 * address they log in with.
 *
 * It is masked by the same switch that masks the address — a screen-share of
 * the 360 should not hand out somebody's WeChat id — but the copy button puts
 * the real one on the clipboard, because the reason to press it is to paste it
 * into WeChat, and a masked id pasted there finds nobody.
 *
 * A customer with none gets the sentence rather than an em dash: this is a
 * field the operator can go and fill in, and the em dash is for measurements
 * that failed to arrive.
 */
export function CustomerWechat({ wechatId }: { wechatId: string | null }) {
  const privacy = usePrivacy();
  const [copied, setCopied] = useState(false);

  if (wechatId === null || wechatId.trim() === '') {
    return (
      <span className="text-body text-[var(--muted-foreground)]">{copy.wechatNudge}</span>
    );
  }
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="text-micro text-[var(--muted-foreground)]">{copy.wechatField}</span>
      <span className="min-w-0 truncate text-row">{privacy.wechat(wechatId)}</span>
      <Action
        onClick={() => {
          void navigator.clipboard?.writeText(wechatId).then(() => setCopied(true));
        }}
      >
        {copied ? copy.wechatCopied : copy.wechatCopy}
      </Action>
    </span>
  );
}

/**
 * Which device, and then the sentence naming it.
 *
 * The picker is inside the confirmation rather than before it because the
 * name of the machine is half the consequence: "queues a snapshot" is not
 * something an operator can check, and "queues a snapshot on DESKTOP-HOME"
 * is.
 */
function PickDialog({
  open,
  userId,
  devices,
  onClose,
  onChanged,
}: {
  open: boolean;
  userId: string;
  devices: readonly CustomerDeviceDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(onChanged);
  const [picked, setPicked] = useState('');
  const chosen = devices.find((device) => device.id === picked) ?? devices[0];

  if (!open || !chosen) return null;
  return (
    <ConfirmDialog
      open
      title={copy.diagnoseTitle}
      consequence={copy.diagnoseBody(chosen.name)}
      confirm={copy.customerHeadActions.diagnose}
      pending={ask.pending}
      failure={ask.error}
      onConfirm={() => {
        void ask.run(async () => {
          await customerApi.queueDeviceAction(chosen.id, 'diagnostic_snapshot');
          await followupApi.addForCustomer(userId, {
            kind: 'reply',
            body: copy.followupAuto.diagnose,
          });
        }).then((done) => {
          if (done) onClose();
        });
      }}
      onCancel={() => {
        ask.clearError();
        onClose();
      }}
    >
      {devices.length > 1 ? (
        <SelectField
          label={copy.pickDevice}
          value={chosen.id}
          options={devices.map((device) => device.id)}
          word={(id) => devices.find((device) => device.id === id)?.name ?? id}
          onChange={setPicked}
        />
      ) : null}
    </ConfirmDialog>
  );
}

/** Suspension, with the reason that goes on the audit line beside it. */
function SuspendDialog({
  open,
  email,
  userId,
  onClose,
  onChanged,
}: {
  open: boolean;
  email: string;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ask = useAsk(onChanged);
  const [reason, setReason] = useState('');

  if (!open) return null;
  return (
    <ConfirmDialog
      open
      title={copy.suspendTitle}
      consequence={copy.suspendBody(email)}
      confirm={copy.suspendConfirm}
      pending={ask.pending}
      failure={ask.error}
      onConfirm={() => {
        void ask.run(() => customerApi.closeUser(userId, reason.trim())).then((done) => {
          if (done) {
            setReason('');
            onClose();
          }
        });
      }}
      onCancel={() => {
        ask.clearError();
        onClose();
      }}
    >
      <TextField label={copy.suspendReason} value={reason} onChange={setReason} />
    </ConfirmDialog>
  );
}
