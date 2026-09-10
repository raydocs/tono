import type { WorthwhileDto, WorthwhilePickDto } from '@contract';
import { copy } from '@/copy/copy';
import { goPage, openCustomer, openNodePage, openSettings } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { confidenceWord, payoffText, sentenceOf } from '@/lib/worthwhile';

export function Worthwhile({ data }: { data: WorthwhileDto | undefined }) {
  const privacy = usePrivacy();
  if (data === undefined) return null;
  return (
    <div className="worthwhile flex min-w-0 flex-col gap-1.5">
      <h3 className="text-micro text-[var(--muted-foreground)]">{copy.worthwhileTitle}</h3>
      {data.picks.length === 0 ? (
        <p className="text-body text-[var(--muted-foreground)]">{copy.worthwhileNone}</p>
      ) : (
        data.picks.map((pick) => (
          <Pick key={pick.id} pick={pick} label={labelOf(pick, privacy.secret)} />
        ))
      )}
    </div>
  );
}

function Pick({ pick, label }: { pick: WorthwhilePickDto; label: string }) {
  return (
    <div className="worthwhile-row flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-0 text-body">{sentenceOf(pick, label)}</span>
      <span className="text-micro text-[var(--muted-foreground)]">{payoffText(pick.payoff)}</span>
      <span className="ops-tag shrink-0">{confidenceWord(pick.confidence)}</span>
      <button
        type="button"
        className="shrink-0 text-body underline-offset-4 hover:underline"
        onClick={() => go(pick)}
      >
        {copy.worthwhileGo}
      </button>
    </div>
  );
}

function labelOf(pick: WorthwhilePickDto, mask: (value: string) => string): string {
  return pick.subjectType === 'user' ? mask(pick.subjectLabel) : pick.subjectLabel;
}

function go(pick: WorthwhilePickDto) {
  const { page, section, subjectId } = pick.action;
  if (page === 'nodes' && subjectId) {
    openNodePage(subjectId);
    return;
  }
  if (page === 'customers' && subjectId) {
    openCustomer(subjectId);
    return;
  }
  if (page === 'settings' && section) {
    openSettings(section);
    return;
  }
  goPage(page);
}
