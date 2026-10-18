import { Action } from '@/components/ops/Action';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { copy } from '@/copy/copy';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { placeWord, type EgressLookup, type GeoAnswer } from '@/lib/home-egress';
import { cn } from '@/lib/utils';

const words = copy.residential.inventory.egress;

function stageWord(stage: string | null): string {
  const known = words.stage as Record<string, string | undefined>;
  return (stage === null ? undefined : known[stage]) ?? stage ?? copy.missing;
}

/** The table cell: the address the line really exits from, and where most databases put it. */
export function EgressCell({
  lookup,
  looking,
  ip,
  onOpen,
}: {
  lookup: EgressLookup | undefined;
  looking: boolean;
  ip: (value: string | null) => string;
  onOpen: () => void;
}) {
  let first: string;
  let second: string | null = null;
  let tone: 'warn' | 'sev' | null = null;
  if (looking) {
    first = words.looking;
  } else if (lookup === undefined) {
    first = words.never;
  } else if (lookup.ip === null) {
    first = words.failed(stageWord(lookup.errorStage));
    tone = 'sev';
  } else {
    first = ip(lookup.ip);
    const { consensus } = lookup;
    const place = placeWord(consensus) ?? words.noAnswer;
    second = consensus.of === 0 ? place : `${place} · ${words.votes(consensus.votes, consensus.of)}`;
    if (consensus.conflict) tone = 'warn';
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 flex-col items-start text-left leading-tight"
      title={lookup?.consensus.conflict ? words.conflict : undefined}
    >
      <span className={cn('truncate', lookup?.ip ? 'font-mono' : 'text-[var(--muted-foreground)]', tone === 'sev' && 'tone-sev tone-fg')}>
        {first}
      </span>
      {second === null ? null : (
        <span className={cn('max-w-full truncate text-[11px] text-[var(--muted-foreground)]', tone === 'warn' && 'tone-warn tone-fg')}>
          {second}
        </span>
      )}
    </button>
  );
}

function answerPlace(answer: GeoAnswer): string {
  const parts = [answer.city, answer.region, answer.country].filter((part): part is string => part !== null);
  return parts.length === 0 ? copy.missing : parts.join(', ');
}

function answerOrg(answer: GeoAnswer): string {
  if (answer.org === null && answer.asn === null) return copy.missing;
  return [answer.asn === null ? null : `AS${String(answer.asn)}`, answer.org].filter(Boolean).join(' ');
}

/** Every provider's answer side by side, and the button that dials the line again. */
export function EgressDrawer({
  line,
  lookup,
  looking,
  error,
  ip,
  onLookUp,
  onClose,
}: {
  line: { id: string; displayName: string } | null;
  lookup: EgressLookup | undefined;
  looking: boolean;
  error: string | null;
  ip: (value: string | null) => string;
  onLookUp: (homeExitId: string) => void;
  onClose: () => void;
}) {
  const majority = lookup?.consensus.region ?? null;
  return (
    <DetailDrawer
      open={line !== null}
      title={line === null ? '' : words.title(line.displayName)}
      onClose={onClose}
      footer={line === null ? null : (
        <Action primary pending={looking} onClick={() => onLookUp(line.id)}>
          {looking ? words.looking : lookup === undefined ? words.lookUp : words.again}
        </Action>
      )}
    >
      <p className="text-body text-[var(--muted-foreground)]">{words.lead}</p>
      {error ? <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{error}</p> : null}
      {lookup === undefined ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-[var(--muted-foreground)]">{words.ip}</dt>
          <dd className={cn(lookup.ip === null ? 'tone-sev tone-fg' : 'font-mono')}>
            {lookup.ip === null ? `${stageWord(lookup.errorStage)} · ${lookup.error ?? ''}` : ip(lookup.ip)}
          </dd>
          <dt className="text-[var(--muted-foreground)]">{words.place}</dt>
          <dd className={cn(lookup.consensus.conflict && 'tone-warn tone-fg')}>
            {placeWord(lookup.consensus) ?? copy.missing}
            {lookup.consensus.of > 0 ? ` · ${words.votes(lookup.consensus.votes, lookup.consensus.of)}` : ''}
            {lookup.consensus.conflict ? ` · ${words.conflict}` : ''}
          </dd>
          <dt className="text-[var(--muted-foreground)]">{words.checkedAt}</dt>
          <dd title={formatWhen(lookup.checkedAt)}>{formatWhenAgo(lookup.checkedAt)}</dd>
        </dl>
      )}
      {lookup === undefined || lookup.answers.length === 0 ? null : (
        <table className="egress-answers w-full text-[12px]">
          <thead>
            <tr className="text-left text-[var(--muted-foreground)]">
              <th scope="col">{words.columns.provider}</th>
              <th scope="col">{words.columns.place}</th>
              <th scope="col">{words.columns.org}</th>
            </tr>
          </thead>
          <tbody>
            {lookup.answers.map((answer) => {
              const odd = answer.ok && majority !== null && answer.region !== null
                && answer.region.toLowerCase() !== majority.toLowerCase();
              return (
                <tr key={answer.provider}>
                  <th scope="row" className="font-mono font-normal">{answer.provider}</th>
                  <td className={cn(!answer.ok && 'text-[var(--muted-foreground)]', odd && 'tone-warn tone-fg')}>
                    {answer.ok ? answerPlace(answer) : answer.error ?? words.noAnswer}
                    {answer.hosting === true ? ` · ${words.hosting}` : ''}
                  </td>
                  <td className="text-[var(--muted-foreground)]">{answer.ok ? answerOrg(answer) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </DetailDrawer>
  );
}
