import { useState } from 'react';
import { Action } from '@/components/ops/Action';
import { copy } from '@/copy/copy';
import { followupApi, type FollowupDto } from '@/lib/api-followups';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { useResource } from '@/lib/use-resource';
import { WriteError } from '../customer/ask';
import { useWrite } from '../settings/use-write';

/**
 * The record: what was already done about this, in the order it was done.
 *
 * The record is shared between an incident and a customer because the work is
 * the same work — somebody was told something, somebody is being waited on,
 * somebody promised to come back — and the review's complaint was that none of
 * it survived the tab being closed. The row below is the one shape both
 * surfaces render; only what may be pressed on it differs.
 */
export function FollowupChip({ kind }: { kind: FollowupDto['kind'] }) {
  return <span className="tone-rem ops-tag shrink-0">{copy.followupKind[kind]}</span>;
}

export function FollowupRow({
  row,
  onDone,
  pending,
}: {
  row: FollowupDto;
  /** Absent where the surface cannot finish one — the incident log only writes notes. */
  onDone?: () => void;
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--hairline)] py-2 last:border-b-0">
      <FollowupChip kind={row.kind} />
      <span className="min-w-0 flex-1 text-body">{row.body}</span>
      <span
        className="shrink-0 text-micro normal-case tracking-normal text-[var(--muted-foreground)]"
        title={row.createdBy === null
          ? formatWhen(row.createdAt)
          : `${formatWhen(row.createdAt)} · ${copy.followupBy(row.createdBy)}`}
      >
        {row.doneAt !== null
          ? copy.followupDoneAt(formatWhenAgo(row.doneAt))
          : row.dueAt !== null
            ? copy.followupDueAt(formatWhenAgo(row.dueAt))
            : formatWhenAgo(row.createdAt)}
      </span>
      {onDone && row.doneAt === null ? (
        <Action pending={pending} onClick={onDone}>{copy.followupDone}</Action>
      ) : null}
    </div>
  );
}

/**
 * The handling log on an incident: every followup against it, newest first,
 * and one box to add another.
 *
 * `beat` is how the drawer forces a refetch after something else wrote here —
 * a re-measure records a line of its own, and a log that does not show it is
 * a log the operator stops trusting within a day.
 */
export function FollowupLog({
  incidentId,
  beat,
}: {
  incidentId: string;
  beat: number;
}) {
  const rows = useResource(incidentId, (signal) => followupApi.forIncident(incidentId, signal), beat);
  const [note, setNote] = useState('');
  const write = useWrite(rows.reload);
  const items = rows.status === 'ready' ? newestFirst(rows.data.items) : [];

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-micro text-[var(--muted-foreground)]">
          {rows.status === 'ready' ? copy.followupNone : copy.loading}
        </p>
      ) : items.map((row) => <FollowupRow key={row.id} row={row} />)}
      <div className="flex gap-2">
        <input
          className="h-8 min-w-0 flex-1 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 text-body outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder={copy.incidentDrawer.notePrompt}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Action
          pending={write.pending || note.trim() === ''}
          onClick={() => {
            void write.run(
              () => followupApi.addForIncident(incidentId, { kind: 'note', body: note.trim() }),
            ).then((done) => { if (done) setNote(''); });
          }}
        >
          {copy.incidentDrawer.noteSend}
        </Action>
      </div>
      <WriteError message={write.error} />
    </div>
  );
}

/** The newest thing that happened is the thing being read; it goes on top. */
export function newestFirst(rows: readonly FollowupDto[]): FollowupDto[] {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}
