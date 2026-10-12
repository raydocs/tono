import { useEffect, useState } from 'react';
import type { ConnectionEventDto, CustomerDeviceDto, CustomerNowDto, Platform } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import {
  REPLY_SECTIONS,
  lastFailedAttempt,
  publicIncidentOn,
  replyDraft,
  spareNode,
  type ReplySection,
} from '@/lib/customers';
import { useResource } from '@/lib/use-resource';

/**
 * Support mode: the answer, drafted from the evidence already on this page.
 *
 * The review's test is one minute from a customer asking to an answer that can
 * be sent, and what made that impossible was not writing speed — it was that
 * the facts an answer needs are in five different blocks. This assembles them
 * in three parts: confirmed (the last failed attempt, where it fell over and what
 * the client called it, the carrier, whether an incident is already open on
 * that machine), to confirm (whether the client is current, whether they already
 * left that machine, the one question worth asking back) and a suggestion (a machine
 * the engine still calls healthy, same region first). Each part can be left
 * out of what is copied.
 *
 * Nothing is generated. Every line is a field, formatted; there is no sentence
 * here that the console cannot show you the measurement behind, because a
 * plausible cause typed into a customer's inbox is a promise nobody measured.
 * The operator edits and copies — sending is somebody else's job.
 */
export function ReplyDraft({
  who,
  events,
  now,
  devices,
}: {
  who: string;
  events: readonly ConnectionEventDto[];
  now: CustomerNowDto | null;
  devices: readonly CustomerDeviceDto[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [include, setInclude] = useState<ReadonlySet<ReplySection>>(() => new Set(REPLY_SECTIONS));
  const failure = lastFailedAttempt(events);

  /**
   * The fleet, the incident list and the release channels are read only once
   * somebody asks for a draft. The customer page already makes six requests
   * before anyone has decided they want to write to anybody.
   */
  const context = useResource(
    open && failure ? 'draft' : null,
    async (signal) => {
      const latest: Partial<Record<Platform, string>> = {};
      for (const row of (await opsApi.releaseChannels(signal)).items) {
        if (row.current !== null) latest[row.platform] = row.current.version;
      }
      return {
        incidents: (await opsApi.incidents(signal)).items,
        nodes: (await opsApi.nodes(signal)).items,
        latest,
      };
    },
  );

  const ready = context.status === 'ready' ? context.data : null;
  const composed = ready === null || failure === null ? null : replyDraft({
    who,
    failure,
    incident: publicIncidentOn(ready.incidents, failure.node),
    spare: spareNode(ready.nodes, failure.node),
    now,
    devices,
    latest: ready.latest,
    include,
  });

  // A toggle re-assembles the draft, replacing any hand edits.
  useEffect(() => {
    if (composed !== null) { setText(composed); setCopied(false); }
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
          <div className="flex flex-wrap gap-4">
            {REPLY_SECTIONS.map((section) => (
              <label key={section} className="flex items-baseline gap-2 text-body">
                <input
                  type="checkbox"
                  className="translate-y-[2px]"
                  checked={include.has(section)}
                  onChange={(event) => {
                    const next = new Set(include);
                    if (event.target.checked) next.add(section);
                    else next.delete(section);
                    setInclude(next);
                  }}
                />
                <span>{copy.replySectionToggle[section]}</span>
              </label>
            ))}
          </div>
          <textarea
            className="min-h-[320px] w-full rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 py-2 text-body leading-relaxed outline-none"
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
