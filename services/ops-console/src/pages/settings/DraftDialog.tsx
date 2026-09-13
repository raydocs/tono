import { useEffect, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copy } from '@/copy/copy';

const words = copy.settings.candidates;

/**
 * The generated routing draft, read-only.
 *
 * Read-only is still the point: nothing here changes live routing. What has
 * changed is where the draft goes next. It used to leave only through the
 * clipboard, into the old console's editor; now it can be carried straight to
 * the rules editor, which is one deliberate step short of publishing rather
 * than one paste short of a truncated document. The copy button stays for the
 * times the draft is going into a note or a message instead.
 */
export function DraftDialog({
  text,
  onClose,
  onLoad,
}: {
  text: string | null;
  onClose: () => void;
  onLoad: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const empty = text !== null && text.trim() === '';

  return (
    <Dialog open={text !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="gap-4 rounded-[10px] border-[var(--hairline)] bg-[var(--surface)] p-5 sm:max-w-[640px]"
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="text-row font-medium">{words.draftTitle}</DialogTitle>
          <DialogDescription className="text-body text-[var(--muted-foreground)]">
            {empty ? words.draftEmpty : words.draftLead}
          </DialogDescription>
        </DialogHeader>
        {empty ? null : (
          <pre className="max-h-[46vh] overflow-auto rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] p-3 font-mono text-body whitespace-pre">
            {text}
          </pre>
        )}
        <ActionRow>
          {empty ? null : (
            <>
              <Action primary onClick={() => onLoad(text ?? '')}>
                {copy.settings.policy.loadDraft}
              </Action>
              <Action
                onClick={() => {
                  void navigator.clipboard?.writeText(text ?? '').then(() => setCopied(true));
                }}
              >
                {copied ? copy.settings.copied : copy.settings.copyText}
              </Action>
            </>
          )}
          <Action onClick={onClose}>{copy.close}</Action>
        </ActionRow>
      </DialogContent>
    </Dialog>
  );
}
