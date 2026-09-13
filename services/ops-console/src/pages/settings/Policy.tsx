import { useEffect, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { copy } from '@/copy/copy';
import { hubApi, refusalCode, type PolicyRehearsal } from '@/lib/settings-legacy';
import {
  checkPolicy,
  policyText,
  takePolicyDraft,
  withoutAnyDirect,
  withoutWebDirect,
} from '@/lib/settings-publish';
import {
  CanonicalBlock,
  CodeBox,
  DiffView,
  DocumentGate,
  DocumentMeta,
  FailurePanel,
  NoticePanel,
} from './Editor';
import { TextField } from './form';
import { useDocument } from './use-document';

const words = copy.settings.policy;

/** The hub's own refusals, said in words rather than in an error name. */
function refusalWord(error: unknown): string | null {
  const code = refusalCode(error);
  if (code === null) return null;
  const said = words.refusal as Record<string, string | undefined>;
  return said[code] ?? null;
}

/**
 * The routing rules: which sites a client is told not to tunnel.
 *
 * Two things make this different from the catalogue. The stored document is
 * minified — one line, thousands of characters — so the editor holds an
 * indented copy and the publish sends the parsed object, which means the
 * whitespace never reaches the wire and a comparison is line-shaped instead of
 * being one line against one line. And some documents have to be signed
 * offline, and a rehearsal is the only way to see the exact text a signature
 * must cover, so it shows that text verbatim rather than a description of it.
 */
export function Policy() {
  const doc = useDocument((signal) => hubApi.trafficPolicy(signal).then((row) => ({
    revision: row.revision,
    text: policyText(row.json),
    updatedAt: row.updatedAt,
    extra: row.signature,
  })));
  const [asking, setAsking] = useState(false);
  const [signature, setSignature] = useState('');
  const [rehearsal, setRehearsal] = useState<{ forText: string; result: PolicyRehearsal } | null>(null);

  const { online, start, change, setNotice } = doc;

  // A draft built on the candidates inbox lands here rather than in a copy
  // dialog: this editor is the only place it can be published from, and a
  // clipboard round trip through another window is where a draft gets cut off.
  useEffect(() => {
    if (online === null) return;
    const handed = takePolicyDraft();
    if (handed === null) return;
    start();
    change(handed);
    setNotice({ text: words.draftLoaded, detail: null, bad: false });
  }, [online, start, change, setNotice]);

  if (online === null) {
    return <DocumentGate status={doc.status === 'error' ? 'error' : 'loading'} message={doc.message} />;
  }

  const draft = doc.draft;
  const dirty = draft !== null && doc.base !== null && draft !== doc.base.text;
  const check = draft === null ? null : checkPolicy(draft);
  const policy = check !== null && check.ok ? check.policy : null;
  const fault = check === null ? words.clean : check.ok ? null : words.fault[check.fault];
  const fresh = rehearsal !== null && rehearsal.forText === draft;
  const needsSignature = rehearsal !== null && fresh && rehearsal.result.signatureRequired;
  const blocked = fault !== null
    ? fault
    : !dirty
      ? words.clean
      : needsSignature && signature.trim() === '' ? words.signatureMissing : null;

  function quick(next: string | null, said: string) {
    if (next === null) {
      setNotice({ text: words.noWeb, detail: null, bad: false });
      return;
    }
    change(next);
    setNotice({ text: said, detail: null, bad: false });
  }

  async function rehearse() {
    if (draft === null || policy === null) return;
    doc.setFailure(null);
    try {
      const result = await hubApi.rehearsePolicy(policy);
      setRehearsal({ forText: draft, result });
    } catch (error) {
      doc.setFailure(refusalWord(error) ?? (error instanceof Error ? error.message : copy.actionFailed));
    }
  }

  async function publish() {
    if (draft === null || policy === null) return;
    const sending = policy;
    const signed = signature.trim() === '' ? null : signature.trim();
    await doc.publish(
      async (expected) => {
        try {
          return (await hubApi.publishPolicy(sending, expected, signed)).revision;
        } catch (error) {
          const said = refusalWord(error);
          throw said === null ? error : new Error(said);
        }
      },
      {
        told: (was, now) => ({ text: words.published(was, now), detail: null, bad: false }),
        conflict: (was, now, drift) => ({
          text: words.conflictTitle,
          detail: [
            words.conflictBody(was, now.revision),
            words.conflictDiff(drift.added, drift.removed),
          ].join(' '),
          bad: true,
        }),
      },
    );
    setAsking(false);
    setSignature('');
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <DocumentMeta
          version={words.online(online.revision)}
          updatedAt={online.updatedAt}
          never={words.never}
          updatedWord={words.updated}
        >
          <span className="text-micro text-[var(--muted-foreground)]">
            {online.extra === null ? words.unsigned : words.signed}
          </span>
          {draft === null ? (
            <Action primary onClick={doc.start}>{words.edit}</Action>
          ) : (
            <>
              <Action
                pending={doc.pending}
                onClick={() => {
                  void doc.reload((row) => ({ text: words.reloadDone(row.revision), detail: null, bad: false }));
                }}
              >
                {words.reload}
              </Action>
              <Action reason={fault} pending={doc.pending} onClick={() => { void rehearse(); }}>
                {words.dryRun}
              </Action>
              <Action primary reason={blocked} pending={doc.pending} onClick={() => setAsking(true)}>
                {words.publish}
              </Action>
            </>
          )}
        </DocumentMeta>

        {doc.notice ? <NoticePanel notice={doc.notice} /> : null}
        {doc.failure ? <FailurePanel failure={doc.failure} /> : null}

        <CodeBox
          label={words.editorLabel}
          value={draft ?? online.text}
          onChange={draft === null ? undefined : doc.change}
        />

        {check !== null && !check.ok ? (
          <p className="text-body text-[var(--muted-foreground)]">{words.fault[check.fault]}</p>
        ) : null}

        {policy === null ? null : (
          <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-3">
            <p className="text-micro text-[var(--muted-foreground)]">{words.quick}</p>
            <ActionRow>
              <Action onClick={() => quick(withoutWebDirect(policy), words.closedWeb)}>
                {words.closeWeb}
              </Action>
              <Action onClick={() => quick(withoutAnyDirect(policy), words.closedAll)}>
                {words.closeAll}
              </Action>
            </ActionRow>
            <p className="text-fine">{words.quickHint}</p>
          </div>
        )}

        {doc.diff === null ? null : dirty ? (
          <DiffView
            diff={doc.diff}
            summary={words.changed(doc.diff.added, doc.diff.removed)}
            truncated={doc.diff.truncated ? words.truncated : null}
          />
        ) : (
          <p className="text-body text-[var(--muted-foreground)]">{words.clean}</p>
        )}

        {rehearsal === null ? null : (
          <Rehearsal
            result={rehearsal.result}
            stale={!fresh}
            signature={signature}
            onSignature={setSignature}
          />
        )}
      </div>

      <ConfirmDialog
        open={asking}
        title={words.publishTitle}
        consequence={words.publishBody}
        confirm={words.publish}
        pending={doc.pending}
        failure={doc.failure}
        onConfirm={() => { void publish(); }}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}

/**
 * What the hub says it would store, and what a signature has to cover.
 *
 * The canonical text is shown in full rather than summarised, because signing
 * is done elsewhere against exactly these bytes: a rendering that pretty-prints
 * it, elides it or reorders a key produces a signature that verifies against
 * nothing.
 */
function Rehearsal({
  result,
  stale,
  signature,
  onSignature,
}: {
  result: PolicyRehearsal;
  stale: boolean;
  signature: string;
  onSignature: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-4">
      <p className="text-body text-[var(--muted-foreground)]">{words.dryRunLead}</p>
      {stale ? <p className="text-fine">{words.dryRunStale}</p> : null}
      <CanonicalBlock title={words.canonical} text={result.json} />
      <p className="text-body">
        {result.signatureRequired ? words.needSignature : words.noSignature}
      </p>
      {result.signatureRequired ? (
        <>
          <CanonicalBlock title={words.signatureContext} text={result.signatureContext} />
          <TextField
            label={words.signature}
            hint={words.signatureHint}
            value={signature}
            onChange={onSignature}
            mono
          />
        </>
      ) : null}
    </div>
  );
}
