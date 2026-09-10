import { copy } from '@/copy/copy';
import type { DigestDto, DigestIncidentDto } from '@/lib/api-followups';
import { severityTone } from '@/lib/codes';
import { goPage, openIncident } from '@/lib/hash-route';
import { beforeNoon } from '@/lib/handling';
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
 */
export function Digest({
  digest,
  openCount,
  choresToday,
  onShowOpen,
  onShowChores,
}: {
  digest: Resource<DigestDto>;
  /** The list's own count, so the block and the tab behind it cannot disagree. */
  openCount: number;
  choresToday: number;
  onShowOpen: () => void;
  onShowChores: () => void;
}) {
  if (digest.status !== 'ready') return null;
  const { overnight, due } = digest.data;
  const night = overnight.resolved.length + overnight.opened.length;
  if (night === 0 && !beforeNoon()) return null;

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
            {overnight.resolved.map((row) => (
              <NightRow
                key={row.id}
                row={row}
                word={copy.incidentClosureWord[row.closure ?? 'verified']}
              />
            ))}
            {overnight.opened.map((row) => (
              <NightRow
                key={row.id}
                row={row}
                word={copy.severity[row.severity]}
                tone={severityTone(row.severity)}
              />
            ))}
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
 * One overnight incident, and its own name as the link.
 *
 * The word in front is how it ended for the ones that ended, and how bad it is
 * for the ones that have not — which is why the caller passes it rather than
 * the row deciding: a night's read that claims a recovery over a false alarm
 * is the same lie, one line further up the page.
 */
function NightRow({
  row,
  word,
  tone,
}: {
  row: DigestIncidentDto;
  word: string;
  tone?: Tone;
}) {
  return (
    <button
      type="button"
      className="flex min-w-0 items-baseline gap-2 text-left"
      onClick={() => openIncident(row.id)}
    >
      <span className={cn('ops-tag shrink-0', tone && `tone-${tone}`)}>{word}</span>
      <span className="min-w-0 truncate text-body underline-offset-4 hover:underline">{row.title}</span>
    </button>
  );
}
