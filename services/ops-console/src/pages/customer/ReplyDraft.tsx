import { useEffect, useState } from 'react';
import type { ConnectionEventDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { lastFailedAttempt, publicIncidentOn, replyDraft, spareNode } from '@/lib/customers';
import { useResource } from '@/lib/use-resource';

/**
 * Support mode: the answer, drafted from the evidence already on this page.
 *
 * The review's test is one minute from a customer asking to an answer that can
 * be sent, and what made that impossible was not writing speed — it was that
 * the six
 * facts an answer needs are in five different blocks. This assembles them:
 * the last failed attempt, where in it the client fell over and what it called
 * that, whether an incident is already open on the machine it was using, a
 * machine the engine still calls healthy, and the one question worth asking
 * back.
 *
 * Nothing is generated. Every line is a field, formatted; there is no sentence
 * here that the console cannot show you the measurement behind, because a
 * plausible cause typed into a customer's inbox is a promise nobody measured.
 * The operator edits and copies — sending is somebody else's job.
 */
export function ReplyDraft({
  who,
  events,
}: {
  who: string;
  events: readonly ConnectionEventDto[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const failure = lastFailedAttempt(events);

  /**
   * The fleet and the incident list are read only once somebody asks for a
   * draft. They are two whole collections, and the customer page already makes
   * six requests before anyone has decided they want to write to anybody.
   */
  const context = useResource(
    open && failure ? 'draft' : null,
    async (signal) => ({
      incidents: (await opsApi.incidents(signal)).items,
      nodes: (await opsApi.nodes(signal)).items,
    }),
  );

  const ready = context.status === 'ready' ? context.data : null;
  const composed = ready === null || failure === null ? null : replyDraft({
    who,
    failure,
    incident: publicIncidentOn(ready.incidents, failure.node),
    spare: spareNode(ready.nodes, failure.node),
  });

  useEffect(() => {
    if (composed !== null) setText((current) => (current === '' ? composed : current));
  }, [composed]);

  return (
    <Section title={copy.replyDraft}>
      <ActionRow>
        {/* Not the page's primary. Colour on a customer belongs to the one
            button that writes something, and this one only drafts. */}
        <Action
          reason={failure === null ? copy.replyDraftNone : null}
          onClick={() => setOpen(true)}
        >
          {copy.replyDraftOpen}
        </Action>
        {open && text !== '' ? (
          <Action
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => setCopied(true));
            }}
          >
            {copied ? copy.replyCopied : copy.replyCopy}
          </Action>
        ) : null}
      </ActionRow>
      {!open ? null : composed === null ? (
        <Empty message={context.status === 'error' ? context.message : copy.loading} />
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[168px] w-full rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 py-2 text-body leading-relaxed outline-none"
            value={text}
            onChange={(event) => { setText(event.target.value); setCopied(false); }}
          />
          <p className="text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
            {copy.replyDraftHint}
          </p>
        </div>
      )}
    </Section>
  );
}
