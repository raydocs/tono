import { useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { followupApi, FOLLOWUP_KINDS, type FollowupKind } from '@/lib/api-followups';
import { useResource } from '@/lib/use-resource';
import { WriteError } from './ask';
import { FollowupRow, newestFirst } from '../today/Followups';
import { SelectField, TextField } from '../settings/form';
import { useWrite } from '../settings/use-write';

/**
 * The service record this console did not have.
 *
 * The review's complaint was that a customer asking the same question twice
 * started from nothing both times — what was said, what is being waited on and
 * who promised to come back existed only in somebody's chat history. Five
 * kinds and a date is the whole vocabulary; anything heavier would be a
 * ticketing system, which is not what one operator needs.
 *
 * `beat` is bumped by the page whenever one of the header's actions wrote a
 * record of its own, so a diagnostic queued upstairs shows up down here
 * without the operator reloading to find out whether it was noted.
 */
export function Followups({ userId, beat }: { userId: string; beat: number }) {
  const rows = useResource(userId, (signal) => followupApi.forCustomer(userId, signal), beat);
  const [kind, setKind] = useState<FollowupKind>('reply');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const write = useWrite(rows.reload);
  const [busy, setBusy] = useState<string | null>(null);

  const items = rows.status === 'ready' ? newestFirst(rows.data.items) : [];
  const ready = body.trim() !== '';

  return (
    <Section title={copy.followupSection}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <SelectField
          label={copy.followupKindLabel}
          value={kind}
          options={FOLLOWUP_KINDS}
          word={(id) => copy.followupKind[id]}
          onChange={setKind}
        />
        <TextField label={copy.followupBodyLabel} value={body} onChange={setBody} />
        <TextField label={copy.followupDueLabel} type="date" value={due} onChange={setDue} />
      </div>
      <ActionRow>
        <Action
          primary
          pending={write.pending || !ready}
          reason={ready ? null : copy.followupNeedBody}
          onClick={() => {
            void write.run(() => followupApi.addForCustomer(userId, {
              kind,
              body: body.trim(),
              dueAt: dayStart(due),
            })).then((done) => {
              if (done) {
                setBody('');
                setDue('');
              }
            });
          }}
        >
          {copy.followupAdd}
        </Action>
      </ActionRow>
      <WriteError message={write.error} />

      {items.length === 0 ? (
        <Empty message={rows.status === 'ready' ? copy.followupNone : copy.loading} />
      ) : (
        <div className="flex flex-col">
          {items.map((row) => (
            <FollowupRow
              key={row.id}
              row={row}
              pending={busy === row.id}
              onDone={() => {
                setBusy(row.id);
                void write.run(() => followupApi.patch(row.id, { done: true }))
                  .finally(() => setBusy(null));
              }}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * A date box gives back `2026-09-12` and the record wants an epoch. Midnight
 * local is the right reading of it: the operator picked a day, not a moment,
 * and shifting it into UTC is how a Monday callback lands on Sunday night.
 */
function dayStart(value: string): number | null {
  if (value === '') return null;
  const at = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(at) ? Math.floor(at / 1_000) : null;
}
