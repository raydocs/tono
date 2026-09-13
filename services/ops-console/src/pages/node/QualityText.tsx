import { useState } from 'react';
import { Action } from '@/components/ops/Action';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { nodeLegacyApi } from '@/lib/node-legacy';
import { useResource } from '@/lib/use-resource';

/**
 * The raw sweep: what the scan actually printed about this machine.
 *
 * It sits under the mainland return table because it is the evidence behind
 * that table — the ports the scan found and the raw backtrace it read them
 * from — and it is folded because it is kilobytes of machine output that
 * nobody reads until the summary above it stops making sense.
 *
 * The fold is also the request: the hub keeps these bodies out of every list
 * response precisely so they are fetched one node at a time, and mounting the
 * body only once the section is open is this side keeping that bargain.
 */
export function NodeQualityText({ name }: { name: string }) {
  return (
    <FoldedSection title={copy.nodeSections.qualityText}>
      <QualityBody name={name} />
    </FoldedSection>
  );
}

function QualityBody({ name }: { name: string }) {
  const text = useResource(name, (signal) => nodeLegacyApi.qualityText(name, signal));

  if (text.status !== 'ready') {
    return <EmptyLine message={text.status === 'error' ? text.message : copy.loading} />;
  }
  const { securityCheck, backtrace } = text.data;
  if (securityCheck === null && backtrace === null) {
    return <EmptyLine message={copy.nodeNoQualityText} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Block title={copy.nodeQualityParts.security} body={securityCheck} />
      <Block title={copy.nodeQualityParts.backtrace} body={backtrace} />
    </div>
  );
}

/**
 * One body, in the machine's own case and the machine's own line breaks.
 *
 * `pre` rather than a paragraph: this text is columns of ports and hop
 * latencies, and reflowing it to the container width makes it unreadable in
 * exactly the situation someone opened it for. It scrolls sideways on its own
 * so a long line cannot widen the page.
 */
function Block({ title, body }: { title: string; body: string | null }) {
  const [copied, setCopied] = useState(false);
  if (body === null) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <span className="text-micro text-[var(--muted-foreground)]">{title}</span>
        <Action
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard?.writeText(body).then(() => setCopied(true));
          }}
        >
          {copied ? copy.nodeQualityCopied : copy.nodeQualityCopy}
        </Action>
      </div>
      <pre className="max-h-[320px] overflow-auto rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 font-mono text-fine leading-relaxed whitespace-pre">
        {body}
      </pre>
    </div>
  );
}
