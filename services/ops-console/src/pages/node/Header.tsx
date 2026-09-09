import type { NodeDetailDto } from '@contract';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { ActionRail } from './ActionRail';

/**
 * The top of the page, in the order an operator reads it: which machine, how
 * it is, whether it is being sold, and then what can be done about it.
 *
 * Health is the only coloured word up here. Whether the machine is being
 * sold is an inventory fact and stays neutral: colouring it would put a
 * second red thing beside the health word and make one problem look like two.
 */
export function NodeHeader({ node, onChanged }: { node: NodeDetailDto; onChanged: () => void }) {
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
            <StatusWord word={node.health} reason={node.reason} />
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
      {node.reason ? <p className="text-body text-[var(--muted-foreground)]">{node.reason}</p> : null}
    </header>
  );
}
