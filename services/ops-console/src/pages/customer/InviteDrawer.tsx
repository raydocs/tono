import { useEffect, useState } from 'react';
import type { FunnelRowDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { allowlistApi } from '@/lib/allowlist-legacy';
import { opsApi } from '@/lib/api';
import { formatDate } from '@/lib/display';
import { stageSentence } from '@/lib/funnel';
import { usePrivacy } from '@/lib/privacy';
import { useAsk, WriteError } from './ask';
import { FieldGrid, TextField } from '../settings/form';

/**
 * The whole of what there is to know about somebody who was opened and never
 * registered — which is why it is a drawer and not a page.
 *
 * They have no `users` row: no devices, no connections, no usage, nothing the
 * 360 is built to show. What exists is an address on the sign-up list, the day
 * it went on, and whatever the operator wrote down about how to reach them.
 * So the drawer is those three fields, the one sentence saying how long they
 * have been stuck, and the two things that can be done — copy the handle and
 * go and ask, or take the invitation back.
 *
 * The copy button puts the real handle on the clipboard while the drawer shows
 * it masked, exactly as the 360 header does: the reason to press it is to
 * paste it into WeChat, and a masked id pasted there finds nobody.
 */
export function InviteDrawer({
  invite,
  onClose,
  onSaved,
}: {
  invite: FunnelRowDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onSaved);
  const [wechatId, setWechatId] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);

  const email = invite?.email ?? '';
  useEffect(() => {
    setWechatId(invite?.wechatId ?? '');
    setContact(invite?.contact ?? '');
    setNotes(invite?.notes ?? '');
    setCopied(false);
    // The stored values, per person: opening a second invite must not show the
    // first one's handle in a box that is about to be saved over theirs.
  }, [invite]);

  if (invite === null) return null;
  const shown = privacy.email(email);
  const handle = invite.wechatId;

  /** Empty and absent are the same thing in a box: both clear the field. */
  const trimmed = (value: string): string | null => (value.trim() === '' ? null : value.trim());

  return (
    <>
      <DetailDrawer open title={shown} onClose={onClose}>
        <p className="text-body text-[var(--muted-foreground)]">{copy.inviteLead}</p>
        <p className="text-row">{stageSentence(invite.stage, invite.stageSinceAt)}</p>

        <FieldGrid>
          <TextField label={copy.inviteFields.wechatId} value={wechatId} onChange={setWechatId} />
          <TextField label={copy.inviteFields.contact} value={contact} onChange={setContact} />
          <TextField label={copy.inviteFields.notes} value={notes} onChange={setNotes} />
        </FieldGrid>

        <Fact
          label={copy.inviteFields.invitedAt}
          measured={measured(
            formatDate(invite.stageSinceAt),
            invite.stageSinceAt,
            copy.sourceWord.manual,
          )}
        />

        <WriteError message={ask.error} />

        <ActionRow>
          <Action
            primary
            pending={ask.pending}
            onClick={() => {
              void ask.run(() => opsApi.patchInvite(email, {
                wechatId: trimmed(wechatId),
                contact: trimmed(contact),
                notes: trimmed(notes),
              }));
            }}
          >
            {copy.inviteSave}
          </Action>
          <Action
            reason={handle === null || handle === '' ? copy.choreNoWechat : null}
            onClick={() => {
              if (handle === null) return;
              void navigator.clipboard?.writeText(handle).then(() => setCopied(true));
            }}
          >
            {copied ? copy.copiedWechat : copy.copyWechat}
          </Action>
          <Action
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.inviteRevokeTitle,
              consequence: copy.inviteRevokeBody(shown),
              confirm: copy.inviteRevoke,
              run: async () => {
                await allowlistApi.remove(email);
                onClose();
              },
            })}
          >
            {copy.inviteRevoke}
          </Action>
        </ActionRow>
      </DetailDrawer>
      {ask.dialog}
    </>
  );
}
