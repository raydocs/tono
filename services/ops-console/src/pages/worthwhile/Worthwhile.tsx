import type { WorthwhileDto, WorthwhilePickDto } from '@contract';
import { copy } from '@/copy/copy';
import { goPage, openCustomer, openNodePage, openSettings } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { confidenceWord, payoffText, sentenceOf } from '@/lib/worthwhile';

/**
 * 本周最值得做的三件事 — the last thing the morning read says.
 *
 * Everything above it is a report: what broke, what recovered, what falls due.
 * This is the only block that has an opinion, and the opinion is deliberately
 * short. Three lines, each one a sentence, a number worth doing it for, how
 * much of that number to believe, and a way into the page where it is done.
 *
 * Two rules it does not bend. An estimate says 估算 out loud and carries the
 * ≈ in front, because a guessed yuan that reads like a measured one turns the
 * whole block into a lie the reader cannot see. And a pick with nothing to
 * claim says so, rather than printing a zero somebody would take for a
 * measurement.
 *
 * A quiet week gets one sentence instead of an empty heading with nothing
 * under it: "nothing this week" is an answer, and a blank block is not.
 */
export function Worthwhile({ data }: { data: WorthwhileDto | undefined }) {
  const privacy = usePrivacy();
  // The Worker grew this field after the digest shipped; a hub that predates
  // it sends a digest without one, and that is not an error worth a red box.
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

/**
 * One line. It wraps rather than truncating: the payoff and the confidence are
 * the two things that justify the line being there at all, and a phone that
 * cut them off would leave the sentence looking like an order.
 */
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

/**
 * A customer id is nobody's name, and it is also the one thing on this block
 * that should not be readable over a shoulder. There is no customer list in
 * the morning read to resolve it against, so it goes through the same masker
 * the rest of the console uses for an opaque identifier.
 */
function labelOf(pick: WorthwhilePickDto, mask: (value: string) => string): string {
  return pick.subjectType === 'user' ? mask(pick.subjectLabel) : pick.subjectLabel;
}

/**
 * Where 去处理 lands.
 *
 * The pick names a page and, where the page has one, the thing on it: a node
 * opens its own page rather than the fleet, because the question "keep this
 * machine or drop it" is answered there and nowhere else.
 */
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
