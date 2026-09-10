import { useEffect, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { customerApi } from '@/lib/api-customer-actions';
import { formatDate } from '@/lib/display';
import { usePrivacy } from '@/lib/privacy';
import { hubApi, type HomeExit } from '@/lib/settings-legacy';
import { useResource } from '@/lib/use-resource';
import { measured } from '@/components/ops/measured';
import type { UserHomeBinding } from '@/lib/customers-legacy';
import { useAsk, WriteError } from './ask';
import { FieldGrid, SelectField, TextField } from '../settings/form';

/**
 * The residential line this customer's Claude traffic leaves through.
 *
 * This is the binding, not the bill. The home-line block in settings edits what a
 * line costs and when it renews; this one decides whose traffic goes down it,
 * and the two write to different endpoints on purpose — a delete that unroutes
 * a paying customer has no business sitting next to a field for the monthly
 * price.
 *
 * Two ways in, because the operator has two situations. A line already in the
 * inventory is picked by name. A line that arrived as a pasted
 * `host:port:user:pass` is registered and bound in one step; its password
 * travels up and is never read back, by this page or any other.
 */
export function HomeLine({
  userId,
  email,
  binding,
  loading,
  message,
  onChanged,
}: {
  userId: string;
  email: string;
  binding: UserHomeBinding | null;
  loading: boolean;
  message: string | null;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(onChanged);
  const [picking, setPicking] = useState(false);

  const address = binding === null ? null : addressOf(binding, privacy.ip);
  const kindWord = copy.homeKind as Record<string, string | undefined>;
  const statusWord = copy.homeStatus as Record<string, string | undefined>;

  return (
    <Section
      title={copy.homeSection}
      aside={binding === null ? null : (
        <span className="ops-tag">{statusWord[binding.homeStatus] ?? binding.homeStatus}</span>
      )}
    >
      {loading ? <Empty message={copy.loading} /> : null}
      {message !== null ? <Empty message={message} /> : null}
      {!loading && message === null && binding === null ? (
        <Empty message={copy.homeNone} />
      ) : null}

      {binding !== null ? (
        <div className="grid gap-x-8 sm:grid-cols-2">
          <Fact
            label={copy.homeFacts.line}
            measured={measured(binding.displayName, binding.updatedAt, copy.sourceWord.manual)}
          />
          <Fact
            label={copy.homeFacts.address}
            measured={measured(address, binding.updatedAt, copy.sourceWord.manual)}
          />
          <Fact
            label={copy.homeFacts.kind}
            measured={measured(
              binding.kind === null ? null : kindWord[binding.kind] ?? binding.kind,
              binding.updatedAt,
              copy.sourceWord.manual,
            )}
          />
          <Fact
            label={copy.homeFacts.defaultNode}
            measured={measured(binding.defaultProxyName, binding.updatedAt, copy.sourceWord.catalog)}
          />
          <Fact
            label={copy.homeFacts.boundAt}
            measured={measured(formatDate(binding.createdAt), binding.createdAt, copy.sourceWord.manual)}
          />
        </div>
      ) : null}

      <WriteError message={ask.error} />

      <ActionRow>
        <Action primary={binding === null} onClick={() => setPicking(true)}>
          {binding === null ? copy.homeBind : copy.homeRebind}
        </Action>
        {binding === null ? null : (
          <Action
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.homeUnbindTitle,
              consequence: copy.homeUnbindBody(email),
              confirm: copy.homeUnbind,
              run: () => customerApi.unbindHome(userId),
            })}
          >
            {copy.homeUnbind}
          </Action>
        )}
      </ActionRow>

      {ask.dialog}

      <BindDrawer
        open={picking}
        userId={userId}
        email={email}
        current={binding}
        onClose={() => setPicking(false)}
        onChanged={onChanged}
      />
    </Section>
  );
}

function addressOf(binding: UserHomeBinding, mask: (value: string | null) => string): string | null {
  const host = binding.socks5Host ?? binding.egressIpv4;
  if (host === null) return null;
  return binding.socks5Port === null ? mask(host) : `${mask(host)}:${String(binding.socks5Port)}`;
}

/**
 * The picker, the paste box, and the default node the binding carries.
 *
 * The inventory is only fetched while this is open: it is one more read on a
 * page that already makes six, and nobody needs the stock list to look at a
 * customer.
 *
 * `defaultProxyName` is sent back as it stands rather than left out, because
 * leaving it out clears it — a re-bind would silently drop the node this
 * customer has been pinned to.
 */
function BindDrawer({
  open,
  userId,
  email,
  current,
  onClose,
  onChanged,
}: {
  open: boolean;
  userId: string;
  email: string;
  current: UserHomeBinding | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const ask = useAsk(() => {
    onChanged();
    onClose();
  });
  const exits = useResource(open ? 'home-exits' : null, (signal) => hubApi.homeExits(signal));
  const [picked, setPicked] = useState('');
  const [line, setLine] = useState('');
  const [node, setNode] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (open) setNode(current?.defaultProxyName ?? '');
  }, [open, current]);

  const rows = exits.status === 'ready' ? exits.data : [];
  const offered = rows.filter((row) => row.status === 'active' && row.id !== current?.homeExitId);
  const chosen = offered.find((row) => row.id === picked) ?? null;

  function shut() {
    setPicked('');
    setLine('');
    setNode('');
    setFault(null);
    ask.clearError();
    onClose();
  }

  function label(row: HomeExit): string {
    const where = privacy.ip(row.socks5Host ?? row.egressIpv4);
    const load = (row.bindCount ?? 0) > 0
      ? copy.homeStockBusy(row.bindCount ?? 0)
      : copy.homeIdle;
    return `${row.displayName} · ${where} · ${load}`;
  }

  function save() {
    const pasted = line.trim();
    const proxy = node.trim() === '' ? null : node.trim();
    if (pasted === '' && chosen === null) {
      setFault(copy.homeLineRequired);
      return;
    }
    setFault(null);
    const replacing = current !== null;
    const stocked = pasted === '' ? chosen : null;
    const name = stocked === null ? pasted.split(':')[0] : stocked.displayName;
    const shared = stocked !== null && (stocked.bindCount ?? 0) > 0
      ? ` ${copy.homeSharedWarn(stocked.bindCount ?? 0)}`
      : '';
    ask.ask({
      title: replacing ? copy.homeRebindTitle : copy.homeBindTitle,
      consequence: (replacing
        ? copy.homeRebindBody(email, name)
        : copy.homeBindBody(email, name)) + shared,
      confirm: replacing ? copy.homeRebind : copy.homeBind,
      run: () => (stocked === null
        ? customerApi.assignHomeLine({
          userId,
          line: pasted,
          replace: replacing,
          ...(proxy === null ? {} : { defaultProxyName: proxy }),
        })
        : customerApi.bindHome(userId, stocked.id, proxy)),
    });
  }

  return (
    <>
      <DetailDrawer
        open={open}
        title={current === null ? copy.homeBindTitle : copy.homeRebindTitle}
        onClose={shut}
        footer={(
          <ActionRow>
            <Action primary pending={ask.pending} onClick={save}>
              {current === null ? copy.homeBind : copy.homeRebind}
            </Action>
            <Action onClick={shut}>{copy.settings.cancel}</Action>
          </ActionRow>
        )}
      >
        <FieldGrid>
          <SelectField
            label={copy.homePickLine}
            value={picked}
            options={['', ...offered.map((row) => row.id)]}
            word={(id) => {
              if (id === '') {
                return exits.status !== 'ready'
                  ? copy.onboardPick.notReady
                  : offered.length === 0 ? copy.homeNoStock : copy.onboardPick.none;
              }
              const row = offered.find((entry) => entry.id === id);
              return row === undefined ? id : label(row);
            }}
            onChange={(value) => {
              setPicked(value);
              if (value !== '') setLine('');
              setFault(null);
            }}
          />
          <TextField
            label={copy.homePasteLine}
            hint={copy.homePasteHint}
            value={line}
            onChange={(value) => {
              setLine(value);
              if (value !== '') setPicked('');
              setFault(null);
            }}
            mono
          />
          <TextField
            label={copy.homeDefaultNode}
            hint={copy.homeDefaultNodeHint}
            value={node}
            onChange={setNode}
            mono
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
