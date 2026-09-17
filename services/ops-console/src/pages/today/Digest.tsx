import { useMemo, useState } from 'react';
import type { CustomerSummaryDto, IncidentDto } from '@contract';
import { copy } from '@/copy/copy';
import { isFollowupOverdue, type DigestDto, type FollowupDto } from '@/lib/api-followups';
import { nowSec } from '@/lib/clock';
import { severityTone } from '@/lib/codes';
import { formatDate } from '@/lib/display';
import { openCustomer, openIncident, openNodePage } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { beforeNoon, capNight, formatLife, groupNight, type NightGroup } from '@/lib/handling';
import type { Tone } from '@/components/ops/StatusWord';
import { useIsPhone } from '@/lib/use-phone';
import type { Resource } from '@/lib/use-resource';
import { Worthwhile } from '../worthwhile/Worthwhile';
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
  customers,
  incidents,
  onShowOpen,
  onShowResolved,
  onShowChores,
}: {
  digest: Resource<DigestDto>;
  /** The list's own count, so the block and the tab behind it cannot disagree. */
  openCount: number | null;
  choresToday: number | null;
  /** Loaded rows used only to name each owed followup's subject. */
  customers: readonly CustomerSummaryDto[];
  incidents: readonly IncidentDto[];
  onShowOpen: () => void;
  onShowResolved: () => void;
  onShowChores: () => void;
}) {
  const phone = useIsPhone();
  if (digest.status !== 'ready') return null;
  const { overnight, due } = digest.data;
  const night = overnight.resolved.length + overnight.opened.length;
  if (night === 0 && !beforeNoon()) return null;
  const ended = capNight(groupNight(overnight.resolved));
  const running = capNight(groupNight(overnight.opened));

  const owed = choresToday === null ? null : due.followups.length + due.checks.length + choresToday;
  if (night === 0 && openCount === 0 && owed === 0) {
    return (
      <section className="today-digest rounded-[12px] border border-[var(--hairline)] px-4 py-3">
        <p className="text-body">{copy.digestQuiet}</p>
      </section>
    );
  }

  const body = (
    <div className="digest-body flex flex-col gap-3">
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
          {openCount === null ? copy.loadError : openCount === 0 ? copy.digestNoOpen : copy.digestOpenCount(openCount)}
        </button>
      </Line>

      <Line title={copy.digestToday}>
        {owed === 0 ? (
          <span className="text-body text-[var(--muted-foreground)]">{copy.digestNoDue}</span>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {due.followups.length === 0 ? null : (
              <DueFollowups rows={due.followups} customers={customers} incidents={incidents} />
            )}
            {due.checks.length === 0 ? null : (
              <Jump onClick={onShowOpen}>{copy.digestDueChecks(due.checks.length)}</Jump>
            )}
            {choresToday === 0 ? null : (
              <Jump onClick={onShowChores}>{choresToday === null ? copy.choresIncomplete : copy.digestDueChores(choresToday)}</Jump>
            )}
          </div>
        )}
      </Line>
    </div>

  );

  /**
   * The weekly picks live in their own card under the morning read rather than
   * inside it: they are a different cadence (week vs night), and the digest
   * keeps the capped one-screen budget the night content was given. Content,
   * order and handlers are unchanged — only the container moved. On a phone it
   * stays folded inside the morning read so the list keeps the first screen.
   */
  const picks = digest.data.worthwhile === undefined ? null : (
    <section className="today-worthwhile-card" aria-label={copy.worthwhileTitle}>
      <Worthwhile data={digest.data.worthwhile} />
    </section>
  );

  /**
   * On a phone the morning read folds shut.
   *
   * It is a paragraph of prose sitting on top of the list it summarises, and
   * on a 390 px screen that paragraph is the whole first screen: the operator
   * who opened the page from an alert at three in the morning has to scroll
   * past yesterday to reach the thing that woke them. Nothing is dropped — the
   * summary keeps the two counts that decide whether it is worth the tap, and
   * everything inside is one tap away.
   */
  if (phone) {
    return (
      <details className="digest-fold rounded-[12px] border border-[var(--hairline)] px-4 py-3">
        <summary className="text-micro text-[var(--muted-foreground)]">
          <span>{copy.digestTitle}</span>
          <span className="normal-case tracking-normal">{copy.digestFold(night, owed)}</span>
        </summary>
        {body}
        {digest.data.worthwhile === undefined ? null : (
          <Worthwhile data={digest.data.worthwhile} />
        )}
      </details>
    );
  }

  return (
    <>
      <section className="today-digest flex flex-col gap-3 rounded-[12px] border border-[var(--hairline)] px-4 py-3">
        <h2 className="text-micro text-[var(--muted-foreground)]">{copy.digestTitle}</h2>
        {body}
      </section>
      {picks}
    </>
  );
}

function Line({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="today-digest-block flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
 * Each owed followup opens its own subject — the customer 360, the incident
 * drawer, or the node page — and says which one before the tap. Kind plus
 * body alone could not tell two identical notes on different subjects apart,
 * and the promised date the comment used to mention was never rendered.
 *
 * Subjects resolve off the already-loaded customer and incident lists with
 * the existing privacy mask; a subject with no loaded row reads as its
 * honest type plus id rather than a guessed handle. The digest only returns
 * rows that carry a due date, so every row has one to show — nothing dateless
 * is dressed up as due today.
 *
 * The subject owns the first line alone and wraps instead of truncating:
 * sharing the line with the fixed tag and date widths crushed it to zero
 * pixels in the narrow aux column on every width, and a hover title is no
 * substitute for a readable name. Kind, note and date share the second
 * line — the note truncates, the date never does — so a row stays two
 * lines tall and the dense morning read keeps its height budget. Overdue
 * follows the Worker's Shanghai calendar-day rule, not the current second.
 *
 * The list caps at a few rows with the rest one tap away in place: 200 owed
 * rows once stretched the morning read past 6600 px. Nothing is dropped and
 * nothing retreats to the customer table.
 */
const DUE_FOLLOWUP_FIRST = 3;

function DueFollowups({
  rows,
  customers,
  incidents,
}: {
  rows: readonly FollowupDto[];
  customers: readonly CustomerSummaryDto[];
  incidents: readonly IncidentDto[];
}) {
  const [expanded, setExpanded] = useState(false);
  const privacy = usePrivacy();
  const now = nowSec();
  const emails = useMemo(() => new Map(customers.map((row) => [row.userId, row.email])), [customers]);
  const titles = useMemo(() => new Map(incidents.map((row) => [row.id, row.title])), [incidents]);
  const mixed = rows.some((row) => row.subjectType !== 'user');
  const shown = expanded ? rows : rows.slice(0, DUE_FOLLOWUP_FIRST);
  return (
    <div className="flex min-w-0 basis-full flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">
        {mixed ? copy.digestDueFollowupsMixed(rows.length) : copy.digestDueFollowups(rows.length)}
      </span>
      {shown.map((row) => {
        const subject = subjectLabel(row, emails, titles, privacy.email);
        const overdue = isFollowupOverdue(row.dueAt, now);
        const when = row.dueAt === null
          ? copy.missing
          : overdue
            ? `${formatDate(row.dueAt)} · ${copy.digestDueOverdue}`
            : formatDate(row.dueAt);
        return (
          <button
            key={row.id}
            type="button"
            className="flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--background)] max-[640px]:min-h-[44px] max-[640px]:justify-center"
            aria-label={`${copy.followupKind[row.kind]} ${subject} ${row.body} ${when}`}
            title={`${subject} ${when}`}
            onClick={() => openFollowup(row)}
          >
            <span className="min-w-0 text-body break-all">{subject}</span>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="tone-rem ops-tag shrink-0">{copy.followupKind[row.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-body underline-offset-4 hover:underline">{row.body}</span>
              <span className="shrink-0 font-mono text-micro text-[var(--muted-foreground)]">{when}</span>
            </span>
          </button>
        );
      })}
      {expanded || rows.length <= DUE_FOLLOWUP_FIRST ? null : (
        <button type="button" className="self-start rounded-lg px-2 py-1.5 text-left text-body underline-offset-4 hover:underline max-[640px]:min-h-[44px]" onClick={() => setExpanded(true)}>
          {copy.digestDueMore(rows.length - DUE_FOLLOWUP_FIRST)}
        </button>
      )}
    </div>
  );
}

function subjectLabel(
  row: FollowupDto,
  emails: ReadonlyMap<string, string>,
  titles: ReadonlyMap<string, string>,
  mask: (value: string) => string,
): string {
  if (row.subjectType === 'user') {
    const email = emails.get(row.subjectId);
    return email === undefined ? copy.digestFollowupUnknownUser(row.subjectId) : mask(email);
  }
  if (row.subjectType === 'incident') {
    return titles.get(row.subjectId) ?? copy.digestFollowupUnknownIncident(row.subjectId);
  }
  return row.subjectId;
}

function openFollowup(row: FollowupDto): void {
  if (row.subjectType === 'user') openCustomer(row.subjectId);
  else if (row.subjectType === 'incident') openIncident(row.subjectId);
  else openNodePage(row.subjectId);
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
    <div className="night-group today-night-row flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        className="flex min-w-0 items-baseline gap-2 text-left"
        onClick={() => openIncident(group.lead.id)}
      >
        <span className={cn('ops-tag shrink-0', tone && `tone-${tone}`)}>{word}</span>
        {/* One line on a laptop, where there is room for one. On a phone the
            ellipsis lands mid-name — "Los Angeles · Mes…" identifies nothing —
            so the class is a hook the phone rules undo. */}
        <span className="night-title min-w-0 truncate text-body underline-offset-4 hover:underline">{title}</span>
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
