import { useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copy } from '@/copy/copy';
import { usePrivacy } from '@/lib/privacy';
import { hubApi, type ImportOutcome } from '@/lib/settings-legacy';
import { useWrite } from './use-write';

const words = copy.settings.homeinventory;
const MAX_LINES = 50;

/**
 * Pasting a batch of lines in.
 *
 * The result is three numbers rather than a success toast, because the
 * interesting outcome is never "it worked": it is the four lines that were
 * already in stock and the one that was typed with a comma. Each of those keeps
 * its own row here so the operator can fix that one line rather than re-paste
 * the block and collect the same duplicates again.
 */
export function ImportDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const privacy = usePrivacy();
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const write = useWrite(onSaved);

  function shut() {
    setText('');
    setOutcome(null);
    setFault(null);
    write.setError(null);
    onClose();
  }

  function submit() {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_LINES);
    if (lines.length === 0) {
      setFault(words.importEmpty);
      return;
    }
    setFault(null);
    void write.run(async () => {
      const result = await hubApi.importHomeExits(lines);
      setOutcome(result);
      if (result.created.length > 0) setText('');
    });
  }

  const problem = fault ?? write.error;
  const summary = outcome === null ? [] : [
    outcome.created.length > 0 ? words.importAdded(outcome.created.length) : null,
    outcome.skipped.length > 0 ? words.importSkipped(outcome.skipped.length) : null,
    outcome.failed.length > 0 ? words.importFailed(outcome.failed.length) : null,
  ].filter((line): line is string => line !== null);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) shut(); }}>
      <DialogContent
        showCloseButton={false}
        className="gap-4 rounded-[10px] border-[var(--hairline)] bg-[var(--surface)] p-5 sm:max-w-[560px]"
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="text-row font-medium">{words.importTitle}</DialogTitle>
          <DialogDescription className="text-body text-[var(--muted-foreground)]">
            {words.importLead}
          </DialogDescription>
        </DialogHeader>

        <textarea
          aria-label={words.importLabel}
          spellCheck={false}
          rows={5}
          value={text}
          onChange={(event) => { setText(event.target.value); setFault(null); }}
          className="w-full resize-none rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] p-3 font-mono text-[12px] leading-[18px] outline-none focus:border-[var(--accent)]"
        />

        {problem ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{problem}</p>
        ) : null}

        {outcome === null ? null : (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-body">
              {summary.length === 0 ? words.importNothing : summary.join(' · ')}
            </p>
            {outcome.skipped.length + outcome.failed.length === 0 ? null : (
              <ul className="flex max-h-[140px] flex-col gap-1 overflow-auto">
                {outcome.skipped.map((row, at) => (
                  <li key={`skip-${at}`} className="text-fine">
                    <span className="font-mono">{privacy.ip(row.host)}</span> {words.importAgain}
                  </li>
                ))}
                {outcome.failed.map((row, at) => (
                  <li key={`fail-${at}`} className="text-fine">{row.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ActionRow>
          <Action primary pending={write.pending} onClick={submit}>{words.importAction}</Action>
          <Action onClick={shut}>{copy.close}</Action>
        </ActionRow>
      </DialogContent>
    </Dialog>
  );
}
