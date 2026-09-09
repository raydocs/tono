import type { AdoptionBucket, AdoptionMatrixDto, Platform } from '@contract';
import { ADOPTION_BUCKETS, PLATFORMS } from '@contract';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import { formatCount } from '@/lib/display';
import { customersHref } from '@/lib/hash-route';
import { cn } from '@/lib/utils';

/**
 * Platform by version band.
 *
 * The one thing this grid must never do is print a zero for a platform
 * nobody has shipped a client for: "0 on the latest" reads as a fleet that
 * refused to upgrade, when the truth is that there is nothing to upgrade to.
 * `released` on the matrix is the Worker's own answer to that, and every cell
 * of an unreleased row says so in words instead.
 *
 * Every other cell is a link rather than a number, because the question after
 * "eleven are behind" is always "which eleven".
 */
export function AdoptionMatrix({ matrix }: { matrix: AdoptionMatrixDto }) {
  const released = new Set(matrix.released);
  const byKey = new Map(matrix.cells.map((cell) => [`${cell.platform}:${cell.bucket}`, cell]));
  if (matrix.cells.length === 0 && released.size === 0) {
    return <Empty message={copy.emptyAdoption} />;
  }

  return (
    <div className="raised overflow-x-auto rounded-[10px] bg-[var(--surface)]">
      <table className="w-full table-fixed border-collapse text-body">
        <thead className="data-head bg-[var(--surface)]">
          <tr className="data-row border-b border-[var(--hairline)]">
            <th className="px-3 text-left text-micro font-medium text-[var(--muted-foreground)]">
              {copy.deviceColumns.platform}
            </th>
            {ADOPTION_BUCKETS.map((bucket) => (
              <th
                key={bucket}
                className="px-3 text-right text-micro font-medium text-[var(--muted-foreground)]"
              >
                {copy.bucket[bucket]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((platform) => (
            <tr key={platform} className="data-row border-b border-[var(--hairline)] last:border-b-0">
              <td className="px-3 text-row">{copy.platform[platform]}</td>
              {ADOPTION_BUCKETS.map((bucket) => (
                <td key={bucket} className="px-3 text-right">
                  {released.has(platform) ? (
                    <Cell
                      platform={platform}
                      bucket={bucket}
                      users={byKey.get(`${platform}:${bucket}`)?.users ?? 0}
                      devices={byKey.get(`${platform}:${bucket}`)?.devices ?? 0}
                    />
                  ) : (
                    <span
                      className="text-fine"
                      title={copy.clientsUnreleasedTitle(copy.platform[platform])}
                    >
                      {copy.unreleased}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Users, with the device count behind it.
 *
 * Users is the figure because the link goes to the customer list and that is
 * what the list then holds; devices is the figure the release engineer wants,
 * so it travels in the title rather than as a second number nobody can tell
 * apart from the first.
 */
function Cell({
  platform,
  bucket,
  users,
  devices,
}: {
  platform: Platform;
  bucket: AdoptionBucket;
  users: number;
  devices: number;
}) {
  return (
    <a
      href={customersHref(platform, bucket)}
      title={copy.bucketCell(users, devices)}
      /* The underline is always there, dotted and in the hairline colour: a
         bare number gives no reason to try clicking it, and colour is spent
         on status words and primary actions rather than on links. */
      className={cn(
        'font-mono underline decoration-dotted decoration-[var(--muted-foreground)] underline-offset-4',
        'hover:decoration-solid hover:decoration-[var(--foreground)]',
        users === 0 && 'text-[var(--muted-foreground)]',
      )}
    >
      {formatCount(users)}
    </a>
  );
}
