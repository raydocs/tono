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
 * Read-only is the whole point: the console can propose what the direct list
 * should look like, and publishing it stays a deliberate act somewhere else.
 * A box you can edit here would imply that pressing something applies it.
 */
export function DraftDialog({ text, onClose }: { text: string | null; onClose: () => void }) {
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
            <Action
              primary
              onClick={() => {
                void navigator.clipboard?.writeText(text ?? '').then(() => setCopied(true));
              }}
            >
              {copied ? copy.settings.copied : copy.settings.copyText}
            </Action>
          )}
          <Action onClick={onClose}>{copy.close}</Action>
        </ActionRow>
      </DialogContent>
    </Dialog>
  );
}
