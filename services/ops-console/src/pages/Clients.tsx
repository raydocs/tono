import { useMemo } from 'react';
import type { AdoptionMatrixDto, Platform, ReleaseDto, SystemHealthDto } from '@contract';
import { PLATFORMS } from '@contract';
import { CountText } from '@/components/ops/CountText';
import { Empty } from '@/components/ops/Empty';
import { PageNote } from '@/components/ops/PageNote';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { releasedPlatformSet } from '@/lib/releases';
import { newestFetch, useResource, type Resource } from '@/lib/use-resource';
import { AdoptionMatrix } from './clients/AdoptionMatrix';
import { ReleaseTable } from './clients/ReleaseTable';

/**
 * The clients page: what each platform is running, and what should ship next.
 *
 * Two questions, two blocks. The matrix answers "who is behind" and every
 * cell of it is a link into the customer list already filtered, because the
 * answer to a count is always a list. The release tables answer "what have we
 * got", and carry the three writes — publish, withdraw, set the supported
 * floor — each behind a dialog that repeats what will happen to people who
 * already installed it.
 */
export default function ClientsPage({
  releases,
  health,
  onChanged,
}: {
  releases: Resource<ReleaseDto[]>;
  health: Resource<SystemHealthDto>;
  onChanged: () => void;
}) {
  const adoption = useResource('releases/adoption', (signal) => opsApi.releaseAdoption(signal));
  const rows = useMemo(
    () => (releases.status === 'ready' ? releases.data : []),
    [releases],
  );
  const shipped = useMemo(() => releasedPlatformSet(rows), [rows]);
  const totals = adoption.status === 'ready' ? bucketTotals(adoption.data) : null;

  return (
    <div className="page-wrap">
      <div className="page-head">
        {totals === null ? (
          <p className="text-verdict text-[var(--muted-foreground)]">
            {adoption.status === 'loading' ? copy.loading : copy.loadError}
          </p>
        ) : totals.platforms === 0 ? (
          /* Nothing has ever shipped, so nobody can be current or behind:
             "0 on the latest" would be a measurement of a fleet that does not
             exist yet, which is the same lie as a zero in an unreleased cell. */
          <p className="text-verdict">{copy.noClientsYet}</p>
        ) : (
          <p className="text-verdict">
            <CountText
              values={[totals.current, totals.behind, totals.unreported]}
              render={(v) => [
                copy.adoptionCount.current(v[0]),
                copy.adoptionCount.behind(v[1]),
                copy.adoptionCount.unreported(v[2]),
              ].join(' · ')}
            />
          </p>
        )}
        <PageNote
          fetchedAt={newestFetch(releases, adoption, health)}
          backfill={health.status === 'ready' ? health.data.backfill : null}
        />
      </div>

      <Section title={copy.clientSections.adoption}>
        {adoption.status === 'ready' ? (
          <AdoptionMatrix matrix={adoption.data} />
        ) : (
          <Empty
            message={adoption.status === 'loading'
              ? copy.loading
              : adoption.message || copy.loadError}
          />
        )}
      </Section>

      <Section title={copy.clientSections.releases}>
        {releases.status !== 'ready' ? (
          <Empty
            message={releases.status === 'loading' ? copy.loading : releases.message || copy.loadError}
          />
        ) : shipped.size === 0 ? (
          <Empty message={copy.noReleases} />
        ) : (
          /* One table per platform that has ever had a build. A platform with
             nothing shipped gets no empty table here — it already says so in
             the matrix above, and a second way of saying it would be a second
             thing to read. */
          <div className="flex flex-col gap-8">
            {PLATFORMS.filter((platform) => shipped.has(platform)).map((platform) => (
              <div key={platform} className="flex flex-col gap-2">
                {/* Not `.text-micro`: that label style is uppercase, and
                    "MACOS" is not what the platform is called. */}
                <h3 className="text-body font-medium text-[var(--muted-foreground)]">
                  {copy.platform[platform]}
                </h3>
                <ReleaseTable
                  platform={platform}
                  releases={rows}
                  onChanged={() => { onChanged(); adoption.reload(); }}
                />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * The sentence's three numbers.
 *
 * The two "behind" buckets add up into one word because the sentence is a
 * verdict, not the matrix: the split between them is a row below, and an
 * opening line with four numbers in it is a table someone wrote as prose.
 * Unreleased platforms contribute nothing at all — there is nobody on them to
 * be current or behind.
 */
function bucketTotals(matrix: AdoptionMatrixDto): {
  platforms: number;
  current: number;
  behind: number;
  unreported: number;
} {
  const released = new Set<Platform>(matrix.released);
  const out = { platforms: released.size, current: 0, behind: 0, unreported: 0 };
  for (const cell of matrix.cells) {
    if (!released.has(cell.platform)) continue;
    if (cell.bucket === 'current') out.current += cell.users;
    else if (cell.bucket === 'unreported') out.unreported += cell.users;
    else out.behind += cell.users;
  }
  return out;
}
