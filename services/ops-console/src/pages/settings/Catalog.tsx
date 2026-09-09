import { ArrowUpRight } from 'lucide-react';
import { copy } from '@/copy/copy';

const words = copy.settings.catalog;

/**
 * Catalogue and routing rules: the one section that is only a signpost.
 *
 * The node catalogue and the routing rules are still edited as text on the old
 * console. Rebuilding those editors here before the old ones are retired would
 * give two places to change the same file, and the failure mode of that is a
 * fleet where half the nodes came from each — so this says where to go and
 * offers nothing to press by accident.
 */
export function Catalog() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-[10px] border border-dashed border-[var(--hairline)] bg-[var(--surface)] px-6 py-8">
      <p className="max-w-[46ch] text-body text-[var(--muted-foreground)]">{words.body}</p>
      <a
        href="/ops/"
        className="inline-flex items-center gap-1 text-body underline-offset-4 hover:underline"
      >
        <span className="text-[var(--accent)]">{words.link}</span>
        <ArrowUpRight size={14} strokeWidth={1.75} className="text-[var(--accent)]" />
      </a>
      <p className="text-micro text-[var(--muted-foreground)]">{copy.emptyMigrated}</p>
    </div>
  );
}
