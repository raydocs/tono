import type { NodeDetailDto } from '@contract';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { reasonSentence } from '@/lib/node-detail';
import { ActionRail } from './ActionRail';

/**
 * The top of the page, in the order an operator reads it: which machine, how
 * it is, whether it is being sold, and then what can be done about it.
 *
 * Health is the only coloured word up here. Whether the machine is being
 * sold is an inventory fact and stays neutral: colouring it would put a
 * second red thing beside the health word and make one problem look like two.
 *
 * A healthy machine gets no reason line at all. The engine still writes one —
 * the rule it matched — and on production that line read a bare `ok` under the
 * word that already said the machine was fine.
 */
export function NodeHeader({ node, onChanged }: { node: NodeDetailDto; onChanged: () => void }) {
  const why = reasonSentence(node.verdict, node.reason);
  const listing = node.catalogListed === null
    ? copy.nodeCatalog.unknown
    : node.catalogListed ? copy.nodeCatalog.listed : copy.nodeCatalog.unlisted;
  const where = [node.facts.region, node.facts.provider].filter(Boolean).join(' · ');

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-verdict">{node.name}</h1>
            <StatusWord word={node.health} reason={why} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ops-tag">{copy.nodeLifecycle[node.lifecycle]}</span>
            <span className="ops-tag">{listing}</span>
            {/* Not `text-micro`: that face is upper-cased, and a provider
                called Bandwagon is not called BANDWAGON. */}
            {where ? (
              <span className="text-body text-[var(--muted-foreground)]">{where}</span>
            ) : null}
          </div>
        </div>
        <ActionRail node={node} onChanged={onChanged} className="ml-auto" />
      </div>
      {why ? <p className="text-body text-[var(--muted-foreground)]">{why}</p> : null}
    </header>
  );
}
