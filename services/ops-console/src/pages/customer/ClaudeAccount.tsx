import { useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import { formatDate } from '@/lib/display';
import { usePrivacy } from '@/lib/privacy';
import { useResource } from '@/lib/use-resource';
import { measured } from '@/components/ops/measured';
import type { CustomerAccountDetail, ProductAccount } from '@/lib/customers-legacy';
import { useAsk, WriteError } from './ask';
import { FieldGrid, SelectField, TextField } from '../settings/form';

/**
 * Which Claude account this customer is on, and the three things that happen
 * to one.
 *
 * The reference is a credential in everything but name — it is what the
 * account is logged into with — so it is masked under the privacy switch like
 * an address, and it is typed in rather than read back anywhere but here.
 *
 * Banning is not the same as replacing, and the two are kept apart. Replacing
 * hands this customer a different account and retires the old one for them;
 * banning marks the account itself as burnt, for everyone, and leaves the
 * customer with nothing until somebody opens another. The sentence in front of
 * each says which of the two is about to happen.
 */
export function ClaudeAccount({
  userId,
  detail,
  loading,
  message,
  onChanged,
}: {
  userId: string;
  detail: CustomerAccountDetail | null;
  loading: boolean;
  message: string | null;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onChanged);
  const [opening, setOpening] = useState(false);
  const [banning, setBanning] = useState(false);

  const current = detail?.accounts.find((row) => row.status === 'assigned') ?? null;
  const statusWord = copy.claudeStatus as Record<string, string | undefined>;
  const eventWord = copy.claudeEventWord as Record<string, string | undefined>;
  const events = detail?.events.slice(0, 8) ?? [];

  return (
    <Section
      title={copy.claudeSection}
      aside={current === null ? null : (
        <span className="ops-tag">{statusWord[current.status] ?? current.status}</span>
      )}
    >
      {loading ? <Empty message={copy.loading} /> : null}
      {message !== null ? <Empty message={message} /> : null}
      {!loading && message === null && current === null ? (
        <Empty message={copy.claudeNone} />
      ) : null}

      {current === null ? null : (
        <div className="grid gap-x-8 sm:grid-cols-2">
          <Fact
            label={copy.claudeFacts.current}
            measured={measured(privacy.secret(current.accountRef), current.updatedAt, copy.sourceWord.manual)}
          />
          <Fact
            label={copy.claudeFacts.openedAt}
            measured={measured(
              current.openedAt === null ? null : formatDate(current.openedAt),
              current.openedAt,
              copy.sourceWord.manual,
            )}
          />
          <Fact
            label={copy.claudeFacts.replaceCount}
            measured={measured(
              copy.claudeReplaceUnit(detail?.replaceCount ?? 0),
              current.updatedAt,
              copy.sourceWord.manual,
            )}
          />
        </div>
      )}

      <WriteError message={ask.error} />

      <ActionRow>
        <Action primary={current === null} onClick={() => setOpening(true)}>
          {current === null ? copy.claudeOpen : copy.claudeReplace}
        </Action>
        {current === null ? null : (
          <Action onClick={() => setBanning(true)}>{copy.claudeBan}</Action>
        )}
      </ActionRow>

      {events.length === 0 ? null : (
        <ul className="flex flex-col">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
            >
              <span className="ops-tag shrink-0">{eventWord[event.type] ?? event.type}</span>
              <span className="mr-auto min-w-0 truncate text-body">
                {event.detail === null ? copy.missing : event.detail}
              </span>
              <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
                {formatDate(event.at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {ask.dialog}

      <AccountDrawer
        open={opening}
        userId={userId}
        current={current}
        onClose={() => setOpening(false)}
        onChanged={onChanged}
      />

      <BanDialog
        open={banning}
        current={current}
        onClose={() => setBanning(false)}
        onChanged={onChanged}
      />
    </Section>
  );
}

/** Typing the new account in, or taking the next one out of the pool. */
function AccountDrawer({
  open,
  userId,
  current,
  onClose,
  onChanged,
}: {
  open: boolean;
  userId: string;
  current: ProductAccount | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(() => {
    onChanged();
    onClose();
  });
  const pool = useResource(open ? 'pooled' : null, (signal) => customerApi.pooledAccounts(signal));
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  const rows = pool.status === 'ready' ? pool.data : [];
  const chosen = rows.find((row) => row.id === picked) ?? null;
  const ref = typed.trim() !== '' ? typed.trim() : chosen?.accountRef ?? '';

  function shut() {
    setTyped('');
    setPicked('');
    setFault(null);
    ask.clearError();
    onClose();
  }

  function save() {
    if (ref === '') {
      setFault(copy.claudeRefRequired);
      return;
    }
    setFault(null);
    const masked = privacy.secret(ref);
    ask.ask(current === null ? {
      title: copy.claudeOpenTitle,
      consequence: copy.claudeOpenBody(masked),
      confirm: copy.claudeOpen,
      run: () => customerApi.openAccount(userId, ref),
    } : {
      title: copy.claudeReplaceTitle,
      consequence: copy.claudeReplaceBody(privacy.secret(current.accountRef), masked),
      confirm: copy.claudeReplace,
      run: () => customerApi.replaceAccount(current.id, ref),
    });
  }

  return (
    <>
      <DetailDrawer
        open={open}
        title={current === null ? copy.claudeOpenTitle : copy.claudeReplaceTitle}
        onClose={shut}
        footer={(
          <ActionRow>
            <Action primary pending={ask.pending} onClick={save}>
              {current === null ? copy.claudeOpen : copy.claudeReplace}
            </Action>
            <Action onClick={shut}>{copy.settings.cancel}</Action>
          </ActionRow>
        )}
      >
        <FieldGrid>
          <TextField
            label={copy.claudeRef}
            value={typed}
            onChange={(value) => {
              setTyped(value);
              if (value !== '') setPicked('');
              setFault(null);
            }}
            mono
          />
          <SelectField
            label={copy.claudePool}
            value={picked}
            options={['', ...rows.map((row) => row.id)]}
            word={(id) => {
              if (id === '') {
                return pool.status !== 'ready'
                  ? copy.onboardPick.notReady
                  : rows.length === 0 ? copy.onboardPick.poolEmpty : copy.onboardPick.none;
              }
              const row = rows.find((entry) => entry.id === id);
              return row === undefined ? id : privacy.secret(row.accountRef);
            }}
            onChange={(value) => {
              setPicked(value);
              if (value !== '') setTyped('');
              setFault(null);
            }}
          />
        </FieldGrid>
        {fault === null ? null : (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{fault}</p>
        )}
      </DetailDrawer>
      {ask.dialog}
    </>
  );
}

/** Banning, with the one line about the account that goes on the record. */
function BanDialog({
  open,
  current,
  onClose,
  onChanged,
}: {
  open: boolean;
  current: ProductAccount | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onChanged);
  const [detail, setDetail] = useState('');

  if (!open || current === null) return null;
  return (
    <ConfirmDialog
      open
      title={copy.claudeBanTitle}
      consequence={copy.claudeBanBody(privacy.secret(current.accountRef))}
      confirm={copy.claudeBan}
      pending={ask.pending}
      failure={ask.error}
      onConfirm={() => {
        void ask.run(() => customerApi.banAccount(current.id, detail.trim())).then((done) => {
          if (done) {
            setDetail('');
            onClose();
          }
        });
      }}
      onCancel={() => {
        ask.clearError();
        onClose();
      }}
    >
      <TextField label={copy.claudeBanDetail} value={detail} onChange={setDetail} />
    </ConfirmDialog>
  );
}
