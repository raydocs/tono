import { Check } from 'lucide-react';
import type { AcceptanceItemDto, NodeAcceptanceDto, NodeLifecycle } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection, Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { formatWhenAgo } from '@/lib/display';
import { acceptanceTone, blockerLabels, orderedAcceptance } from '@/lib/node-detail';
import type { Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

/**
 * The sale-readiness sheet: what this machine has to pass before it is sold.
 *
 * It answers one question — can this machine be given to a customer — and it
 * sits above everything measured because that is the question somebody opening
 * an unlisted node came to ask. A machine already being sold gets the same
 * sheet folded shut: it is then a re-check rather than a decision, and
 * unfolding it by default would put twelve lines above the health of a node
 * somebody opened because it was misbehaving.
 *
 * Blockers come first, and each line carries the fact it was decided on rather
 * than a tick. All-ticks-green is exactly the reading this replaces: the five
 * registrations were all green on a node no mainland customer could reach,
 * because nothing on that row had ever asked a customer.
 */
export function NodeAcceptance({
  sheet,
  lifecycle,
}: {
  sheet: Resource<NodeAcceptanceDto>;
  lifecycle: NodeLifecycle;
}) {
  const body = <AcceptanceBody sheet={sheet} listed={lifecycle === 'listed'} />;
  const ready = sheet.status === 'ready' ? sheet.data : null;

  if (lifecycle === 'listed') {
    return (
      <FoldedSection
        title={copy.nodeSections.acceptance}
        count={ready === null ? null : ready.blockers.length}
      >
        {body}
      </FoldedSection>
    );
  }

  return (
    <Section
      title={copy.nodeSections.acceptance}
      aside={
        <span className="text-micro text-[var(--muted-foreground)]">
          {ready === null || ready.asOfSec === null
            ? copy.nodeAcceptanceNever
            : `${copy.nodeAcceptanceAsOf} ${formatWhenAgo(ready.asOfSec)}`}
        </span>
      }
    >
      {body}
    </Section>
  );
}

function AcceptanceBody({ sheet, listed }: { sheet: Resource<NodeAcceptanceDto>; listed: boolean }) {
  if (sheet.status !== 'ready') {
    return <EmptyLine message={sheet.status === 'error' ? sheet.message : copy.loading} />;
  }
  const data = sheet.data;
  const labels = blockerLabels(data);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn('ops-tag', data.sellable ? null : 'tone-sev')}>
          {data.sellable
            ? copy.nodeAcceptanceReady
            : copy.nodeAcceptanceShort(String(data.blockers.length))}
        </span>
        {labels.length === 0 ? null : (
          <span className="min-w-0 text-body text-[var(--muted-foreground)]">
            {copy.nodeAcceptanceBlockers(labels)}
          </span>
        )}
        {listed ? (
          <span className="text-micro text-[var(--muted-foreground)]">
            {copy.nodeAcceptanceListedNote}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col">
        {orderedAcceptance(data).map((item) => (
          <AcceptanceRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One line: where it stands, what it is, what was measured, and when.
 *
 * The evidence is the point of the row — a state word on its own is the thing
 * that sent operators to five other pages to find out what it meant — so it
 * takes the width and the state word stays a short tag beside it.
 */
function AcceptanceRow({ item }: { item: AcceptanceItemDto }) {
  const tone = acceptanceTone(item.state);
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--hairline)] py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3">
      <span className={cn('ops-tag shrink-0 gap-1', `tone-${tone}`)}>
        {item.state === 'pass' ? <Check size={11} strokeWidth={2} /> : null}
        {copy.nodeAcceptanceState[item.state]}
      </span>
      <span className="shrink-0 text-row">{item.label}</span>
      <span className="min-w-0 flex-1 text-body text-[var(--muted-foreground)]">
        {item.evidence ?? copy.nodeAcceptanceNoEvidence}
      </span>
      <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
        {item.asOfSec === null ? copy.nodeAcceptanceNever : formatWhenAgo(item.asOfSec)}
      </span>
    </li>
  );
}
