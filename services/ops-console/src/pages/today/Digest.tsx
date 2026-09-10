import type { IncidentDto } from '@contract';
import { copy } from '@/copy/copy';
import type { DigestDto } from '@/lib/api-followups';
import { severityTone } from '@/lib/codes';
import { goPage, openCustomer, openIncident, openNodePage } from '@/lib/hash-route';
import { beforeNoon, capNight, formatLife, groupNight, type NightGroup } from '@/lib/handling';
import type { Tone } from '@/components/ops/StatusWord';
import type { Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

/**
 * The morning read: the three questions the review says a morning has to
 * answer, in its order — what happened and recovered overnight, what is
 * waiting now, what falls due today.
 *
 * Two rules keep it honest. It folds away after midday unless the night
 * actually left something behind, because a morning read still on screen at
 * six in the evening is furniture. And a quiet night gets a sentence of its
 * own rather than three empty headings: "nothing happened" is an answer, and
 * the blank block the old page showed was not.
 *
 * The overnight rows carry the closure word, so a rule that fired wrongly
 * reads as a false alarm here too, and is never counted as a repair.
 *
 * The night is grouped and capped. The morning the engine flapped it returned
 * seventy-two rows and this block printed all of them, which is the same as
 * printing none: one line per thing that happened, six lines a half, and the
 * flapping itself said out loud rather than left to be counted.
 */
export function Digest({
  digest,
  openCount,
  choresToday,
  onShowOpen,
  onShowResolved,
  onShowChores,
}: {
  digest: Resource<DigestDto>;
  /** The list's own count, so the block and the tab behind it cannot disagree. */
  openCount: number;
  choresToday: number;
  onShowOpen: () => void;
  onShowResolved: () => void;
  onShowChores: () => void;
}) {
  if (digest.status !== 'ready') return null;
  const { overnight, due } = digest.data;
  const night = overnight.resolved.length + overnight.opened.length;
  if (night === 0 && !beforeNoon()) return null;
  const ended = capNight(groupNight(overnight.resolved));
  const running = capNight(groupNight(overnight.opened));

  const owed = due.followups.length + due.checks.length + choresToday;
  if (night === 0 && openCount === 0 && owed === 0) {
    return (
      <section className="rounded-[12px] border border-[var(--hairline)] px-4 py-3">
        <p className="text-body">{copy.digestQuiet}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-[var(--hairline)] px-4 py-3">
      <h2 className="text-micro text-[var(--muted-foreground)]">{copy.digestTitle}</h2>

      <Line title={copy.digestNight}>
        {night === 0 ? (
          <span className="text-body text-[var(--muted-foreground)]">{copy.digestNightNone}</span>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            {/* What ended carries how it ended and no colour — it is over.
                What is still running carries how bad it is. */}
            {ended.shown.map((group) => (
              <NightLine key={group.key} group={group} />
            ))}
            {ended.hidden === 0 ? null : (
              <MoreGroups count={ended.hidden} onClick={onShowResolved} />
            )}
            {running.shown.map((group) => (
              <NightLine key={group.key} group={group} />
            ))}
            {running.hidden === 0 ? null : (
              <MoreGroups count={running.hidden} onClick={onShowOpen} />
            )}
          </div>
        )}
      </Line>

      <Line title={copy.digestNow}>
        <button type="button" className="text-left text-body underline-offset-4 hover:underline" onClick={onShowOpen}>
          {openCount === 0 ? copy.digestNoOpen : copy.digestOpenCount(openCount)}
        </button>
      </Line>

      <Line title={copy.digestToday}>
        {owed === 0 ? (
          <span className="text-body text-[var(--muted-foreground)]">{copy.digestNoDue}</span>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {due.followups.length === 0 ? null : (
              <Jump onClick={() => goPage('customers')}>{copy.digestDueFollowups(due.followups.length)}</Jump>
            )}
            {due.checks.length === 0 ? null : (
              <Jump onClick={onShowOpen}>{copy.digestDueChecks(due.checks.length)}</Jump>
            )}
            {choresToday === 0 ? null : (
              <Jump onClick={onShowChores}>{copy.digestDueChores(choresToday)}</Jump>
            )}
          </div>
        )}
      </Line>
    </section>
  );
}

function Line({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="w-20 shrink-0 text-micro text-[var(--muted-foreground)]">{title}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Jump({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="text-body underline-offset-4 hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * One thing that happened overnight, however many times it happened.
 *
 * The word in front is how it ended for the ones that ended, and how bad it is
 * for the ones that have not — a night's read that claims a recovery over a
 * false alarm is the same lie, one line further up the page. Where the group
 * ended several different ways the words are counted one by one: nine repairs
 * and one mistake is not the same night as ten repairs, and one word with one
 * count after it would say it was.
 */
function NightLine({ group }: { group: NightGroup }) {
  const ended = group.closures.length > 0;
  const word = ended
    ? copy.digestJoin(group.closures.map((row) => (
      group.closures.length === 1
        ? copy.incidentClosureWord[row.closure]
        : copy.digestTimes(copy.incidentClosureWord[row.closure], row.count)
    )))
    : copy.severity[group.severity];
  const tone: Tone | undefined = ended ? undefined : severityTone(group.severity);
  const title = group.count === 1 ? group.lead.title : copy.digestTimes(group.lead.title, group.count);
  return (
    <div className="night-group flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        className="flex min-w-0 items-baseline gap-2 text-left"
        onClick={() => openIncident(group.lead.id)}
      >
        <span className={cn('ops-tag shrink-0', tone && `tone-${tone}`)}>{word}</span>
        <span className="min-w-0 truncate text-body underline-offset-4 hover:underline">{title}</span>
      </button>
      {group.flap === null ? null : (
        <FlapLine
          row={group.lead}
          text={copy.digestFlap(group.flap.times, formatLife(group.flap.shortest))}
        />
      )}
    </div>
  );
}

/**
 * A rule firing on noise, said in one grey line under the thing it fired on.
 *
 * It goes to the subject's own page rather than to any one of the openings:
 * the question a flapping machine raises is what is wrong with the machine,
 * and the tenth sixty-second incident answers none of it.
 */
function FlapLine({ row, text }: { row: IncidentDto; text: string }) {
  const go = subjectPage(row);
  if (go === null) return <p className={FLAP_NOTE}>{text}</p>;
  return (
    <button type="button" className={`${FLAP_NOTE} underline-offset-4 hover:underline`} onClick={go}>
      {text}
    </button>
  );
}

/**
 * Indented and small, because it is a note about the line above it rather than
 * a line of its own — the night has enough lines that read as equals already.
 * Spelled out rather than merged, which would drop the size for the colour.
 */
const FLAP_NOTE = 'pl-3 text-left text-micro text-[var(--muted-foreground)]';

function subjectPage(row: IncidentDto): (() => void) | null {
  const id = row.subjectId;
  if (id === null || id === '') return null;
  if (row.subjectType === 'node') return () => openNodePage(id);
  if (row.subjectType === 'user') return () => openCustomer(id);
  return null;
}

/** The tail of a capped half: the rest are counted here and listed one tab away. */
function MoreGroups({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-left text-body text-[var(--muted-foreground)] underline-offset-4 hover:underline"
      onClick={onClick}
    >
      {copy.digestMoreGroups(count)}
    </button>
  );
}
