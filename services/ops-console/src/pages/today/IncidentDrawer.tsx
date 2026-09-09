import { useState } from 'react';
import type { CustomerSummaryDto, IncidentDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { severityTone } from '@/lib/codes';
import { formatDurationSince, formatWhen, formatWhenAgo } from '@/lib/display';
import { closeIncident, openCustomer } from '@/lib/hash-route';
import { childrenOf } from '@/lib/incidents';
import { usePrivacy } from '@/lib/privacy';
import { sourceWord } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

/**
 * The incident drawer, addressable as `?incident=`.
 *
 * The three write actions do not touch local state: they POST, then reload
 * both this drawer and the list behind it. An optimistic tick that turns out
 * to be wrong is worse here than a half-second wait — the operator is looking
 * at this page precisely because they no longer trust what they were told.
 */
export function IncidentDrawer({
  id,
  incidents,
  customers,
  onChanged,
}: {
  id: string | null;
  incidents: readonly IncidentDto[];
  customers: readonly CustomerSummaryDto[];
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const detail = useResource(id, (signal) => opsApi.incident(id as string, signal));

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setFailure(null);
    try {
      await action();
      setNote('');
      detail.reload();
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }

  const incident = detail.status === 'ready' ? detail.data.incident : null;
  const children = id === null ? [] : childrenOf(incidents, id);

  return (
    <DetailDrawer open={id !== null} title={incident?.title ?? copy.pages.today} onClose={closeIncident}>
      {detail.status !== 'ready' || !incident ? (
        <Empty message={detail.status === 'error' ? detail.message : copy.loading} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('ops-tag tone-fg', `tone-${severityTone(incident.severity)}`)}>
              {copy.severity[incident.severity]}
            </span>
            <span className="ops-tag">{incident.subjectId ?? copy.missing}</span>
            <span className="text-micro text-[var(--muted-foreground)]">
              {copy.incidentOpenFor}{' '}
              <span className="font-mono normal-case tracking-normal">
                {formatDurationSince(incident.openedAt)}
              </span>
            </span>
          </div>
          {incident.summary ? <p className="text-body">{incident.summary}</p> : null}

          <Block title={copy.incidentDrawer.evidence}>
            {incident.evidence.length === 0 ? (
              <Value value={null} source={sourceWord('engine')} />
            ) : incident.evidence.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 py-1">
                <span className="text-micro text-[var(--muted-foreground)]">{row.label}</span>
                <span className="text-right">
                  <span className="font-mono text-body">{row.value}</span>
                  <span className="ml-2 text-micro text-[var(--muted-foreground)]">
                    {formatWhenAgo(row.asOfSec)} · {sourceWord(row.source)}
                  </span>
                </span>
              </div>
            ))}
          </Block>

          <Block title={copy.incidentDrawer.affected}>
            {children.length === 0 ? (
              <p className="text-micro text-[var(--muted-foreground)]">
                {copy.incidentImpact(incident.impactCount)}
              </p>
            ) : children.map((child) => {
              const person = customers.find((row) => row.userId === child.subjectId);
              return (
                <button
                  key={child.id}
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 py-1 text-left"
                  onClick={() => { if (child.subjectId) openCustomer(child.subjectId); }}
                >
                  <span className="min-w-0 truncate text-body">
                    {person ? privacy.email(person.email) : child.subjectId ?? copy.missing}
                  </span>
                  {person ? <StatusWord word={person.health} reason={person.reason} /> : null}
                </button>
              );
            })}
          </Block>

          <Block title={copy.incidentDrawer.timeline}>
            {detail.data.events.items.map((row) => (
              <div key={row.id} className="flex items-baseline gap-3 py-1">
                <span className="w-24 shrink-0 font-mono text-micro text-[var(--muted-foreground)]" title={formatWhen(row.at)}>
                  {formatWhenAgo(row.at)}
                </span>
                <span className="shrink-0 text-body">{copy.incidentEvent[row.type]}</span>
                <span className="min-w-0 truncate text-micro text-[var(--muted-foreground)]">
                  {row.note ?? row.actor ?? ''}
                </span>
              </div>
            ))}
          </Block>

          <Block title={copy.incidentDrawer.deliveries}>
            {detail.data.deliveries.items.length === 0 ? (
              <Value value={null} source={sourceWord('jobs')} />
            ) : detail.data.deliveries.items.map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0 truncate font-mono text-micro">{row.target}</span>
                <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
                  {copy.deliveryStatus[row.status]} · {formatWhenAgo(row.at)}
                </span>
              </div>
            ))}
          </Block>

          <Block title={copy.incidentDrawer.actions}>
            <ActionRow>
              <Action pending={pending} onClick={() => run(() => opsApi.snoozeIncident(incident.id))}>
                {copy.incidentPrimary.snooze}
              </Action>
              <Action primary pending={pending} onClick={() => run(() => opsApi.resolveIncident(incident.id))}>
                {copy.incidentPrimary.resolve}
              </Action>
            </ActionRow>
            <div className="mt-2 flex gap-2">
              <input
                className="h-8 min-w-0 flex-1 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 text-body outline-none placeholder:text-[var(--muted-foreground)]"
                placeholder={copy.incidentDrawer.notePrompt}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Action
                pending={pending || note.trim() === ''}
                onClick={() => run(() => opsApi.noteIncident(incident.id, note.trim()))}
              >
                {copy.incidentDrawer.noteSend}
              </Action>
            </div>
            {failure ? <p className="panel-error mt-2 rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}
          </Block>
        </>
      )}
    </DetailDrawer>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="mb-1 border-b border-[var(--hairline)] pb-1 text-micro text-[var(--muted-foreground)]">
        {title}
      </h3>
      {children}
    </section>
  );
}
