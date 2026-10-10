import { Action, ActionRow } from '@/components/ops/Action';
import { Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { hy2SwitchApi, type Hy2Override } from '@/lib/hy2-switch';
import { useResource } from '@/lib/use-resource';
import { useAsk, WriteError } from './ask';

/**
 * Whether this account's client may fall back to the backup channel of the
 * same node on its own (A18, D1-C).
 *
 * Two controls, because the hub has two: whether the account is internal —
 * the default turns the switch on for those — and a per-account override
 * that beats both the default and the global switch. Each write is behind the
 * same confirmation every customer write uses and lands on the audit log.
 */
export function Hy2Switch({ userId, email }: { userId: string; email: string }) {
  const state = useResource(`hy2:${userId}`, (signal) => hy2SwitchApi.account(userId, signal));
  const ask = useAsk(state.reload);
  const row = state.status === 'ready' ? state.data : null;
  const fetchedAt = state.status === 'ready' ? state.fetchedAt : null;
  const overrideKey = row?.override ?? 'default';

  function setOverride(next: Hy2Override, word: string) {
    ask.ask({
      title: copy.hy2OverrideTitle,
      consequence: copy.hy2OverrideBody(email, word),
      confirm: word,
      run: () => hy2SwitchApi.setAccount(userId, { override: next }),
    });
  }

  return (
    <Section
      title={copy.hy2Section}
      aside={row === null ? null : (
        <span className="ops-tag">{row.effective ? copy.hy2On : copy.hy2Off}</span>
      )}
    >
      <p className="text-body text-[var(--muted-foreground)]">{copy.hy2Lead}</p>
      {state.status === 'loading' ? <Empty message={copy.loading} /> : null}
      {state.status === 'error' ? <Empty message={state.message} /> : null}

      {row === null ? null : (
        <div className="grid gap-x-8 sm:grid-cols-3">
          <Fact
            label={copy.hy2Facts.internal}
            measured={measured(row.internalAccount ? copy.hy2Yes : copy.hy2No, fetchedAt, copy.sourceWord.manual)}
          />
          <Fact
            label={copy.hy2Facts.setting}
            measured={measured(copy.hy2Override[overrideKey], fetchedAt, copy.sourceWord.manual)}
          />
          <Fact
            label={copy.hy2Facts.effective}
            measured={measured(row.effective ? copy.hy2On : copy.hy2Off, fetchedAt, copy.sourceWord.catalog)}
          />
        </div>
      )}

      <WriteError message={ask.error} />

      {row === null ? null : (
        <ActionRow>
          <Action
            pending={ask.pending}
            onClick={() => ask.ask({
              title: copy.hy2InternalTitle(!row.internalAccount),
              consequence: copy.hy2InternalBody(email, !row.internalAccount),
              confirm: row.internalAccount ? copy.hy2UnmarkInternal : copy.hy2MarkInternal,
              run: () => hy2SwitchApi.setAccount(userId, { internalAccount: !row.internalAccount }),
            })}
          >
            {row.internalAccount ? copy.hy2UnmarkInternal : copy.hy2MarkInternal}
          </Action>
          {overrideKey === 'default' ? null : (
            <Action pending={ask.pending} onClick={() => setOverride(null, copy.hy2SetDefault)}>
              {copy.hy2SetDefault}
            </Action>
          )}
          {overrideKey === 'on' ? null : (
            <Action pending={ask.pending} onClick={() => setOverride('on', copy.hy2SetOn)}>
              {copy.hy2SetOn}
            </Action>
          )}
          {overrideKey === 'off' ? null : (
            <Action pending={ask.pending} onClick={() => setOverride('off', copy.hy2SetOff)}>
              {copy.hy2SetOff}
            </Action>
          )}
        </ActionRow>
      )}

      {ask.dialog}
    </Section>
  );
}
