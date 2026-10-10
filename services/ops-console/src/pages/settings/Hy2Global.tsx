import { useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { hy2SwitchApi } from '@/lib/hy2-switch';
import { useResource } from '@/lib/use-resource';
import { useWrite } from './use-write';

/**
 * The one switch that turns hy2 auto-switch on for every account (D1-C's
 * "everyone, two weeks later"). Nothing flips it on a timer; this button is
 * the only way. A per-account "off" still wins, which the confirmation says
 * with its count, and the reverse confirmation says who stays on.
 */
export function Hy2Global() {
  const state = useResource('hy2-global', (signal) => hy2SwitchApi.global(signal));
  const write = useWrite(state.reload);
  const [asking, setAsking] = useState(false);
  const row = state.status === 'ready' ? state.data : null;
  const fetchedAt = state.status === 'ready' ? state.fetchedAt : null;

  return (
    <Section
      title={copy.hy2GlobalSection}
      aside={row === null ? null : (
        <span className="ops-tag">{row.allAccounts ? copy.hy2On : copy.hy2Off}</span>
      )}
    >
      <p className="text-body text-[var(--muted-foreground)]">{copy.hy2Lead}</p>
      {state.status === 'loading' ? <Empty message={copy.loading} /> : null}
      {state.status === 'error' ? <Empty message={state.message} /> : null}

      {row === null ? null : (
        <>
          <div className="grid gap-x-8 sm:grid-cols-4">
            <Fact
              label={copy.hy2GlobalFacts.state}
              measured={measured(row.allAccounts ? copy.hy2On : copy.hy2Off, row.updatedAt, copy.sourceWord.manual)}
            />
            <Fact
              label={copy.hy2GlobalFacts.internal}
              measured={measured(copy.hy2AccountsUnit(row.internalAccounts), fetchedAt, copy.sourceWord.manual)}
            />
            <Fact
              label={copy.hy2GlobalFacts.pinnedOn}
              measured={measured(copy.hy2AccountsUnit(row.overrideOn), fetchedAt, copy.sourceWord.manual)}
            />
            <Fact
              label={copy.hy2GlobalFacts.pinnedOff}
              measured={measured(copy.hy2AccountsUnit(row.overrideOff), fetchedAt, copy.sourceWord.manual)}
            />
          </div>
          <ActionRow>
            <Action pending={write.pending} onClick={() => { write.setError(null); setAsking(true); }}>
              {row.allAccounts ? copy.hy2GlobalOff : copy.hy2GlobalOn}
            </Action>
          </ActionRow>
          <ConfirmDialog
            open={asking}
            title={row.allAccounts ? copy.hy2GlobalOffTitle : copy.hy2GlobalOnTitle}
            consequence={row.allAccounts
              ? copy.hy2GlobalOffBody(row.internalAccounts, row.overrideOn)
              : copy.hy2GlobalOnBody(row.overrideOff)}
            confirm={row.allAccounts ? copy.hy2GlobalOff : copy.hy2GlobalOn}
            pending={write.pending}
            failure={write.error}
            onConfirm={() => {
              void write.run(() => hy2SwitchApi.setGlobal(!row.allAccounts)).then((done) => {
                if (done) setAsking(false);
              });
            }}
            onCancel={() => setAsking(false)}
          />
        </>
      )}
    </Section>
  );
}
