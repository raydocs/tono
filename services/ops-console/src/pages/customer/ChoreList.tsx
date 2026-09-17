import type { ChoreDto } from '@contract';
import { Empty } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { formatDate } from '@/lib/display';

/** The kind is a free string on the wire; anything unmapped reads as a plain chore. */
function choreWord(kind: string): string {
  const known = copy.choreKind as Record<string, string>;
  return known[kind] ?? copy.choreKindOther;
}

export function CustomerChores({ chores }: { chores: ChoreDto[] }) {
  return (
    <FoldedSection title={copy.customerSections.chores} count={chores.length}>
      {chores.length === 0 ? (
        <Empty message={copy.noChores} />
      ) : (
        <ul className="flex flex-col">
          {chores.map((chore) => (
            <li
              key={chore.id}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
            >
              <span className="tone-rem ops-tag">{choreWord(chore.kind)}</span>
              <span className="mr-auto min-w-0 truncate text-body">{chore.summary}</span>
              <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
                {chore.dueAt === null ? copy.missing : formatDate(chore.dueAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FoldedSection>
  );
}
