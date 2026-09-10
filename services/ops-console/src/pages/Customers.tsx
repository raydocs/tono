import { useMemo, useState } from 'react';
import type { AdoptionBucket, CustomerSummaryDto, Platform, ReleaseDto } from '@contract';
import { ADOPTION_BUCKETS } from '@contract';
import { Action } from '@/components/ops/Action';
import { Chip } from '@/components/ops/Chip';
import { CountText } from '@/components/ops/CountText';
import { DataTable, type TableState } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import {
  bucketCounts,
  CUSTOMER_FILTERS,
  customerCounts,
  planWired,
  PLATFORM_CHIPS,
  platformCounts,
  releasedPlatforms,
  selectByBucket,
  selectByPlatform,
  selectCustomers,
  type CustomerFilter,
  type CustomerFilterId,
} from '@/lib/customers';
import { openCustomer, setCustomerFilter } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { publishedVersions } from '@/lib/releases';
import { cn } from '@/lib/utils';
import type { Resource } from '@/lib/use-resource';
import type { Tone } from '@/components/ops/StatusWord';
import { useCohort } from './customer/Cohort';
import { customerColumns } from './customer/columns';
import { OnboardDrawer } from './customer/OnboardDrawer';

/** Only the two health words carry a tone; the total is prose. */
const FRAGMENT_TONE: Record<CustomerFilterId, Tone | 'none'> = {
  all: 'none',
  ok: 'ok',
  unreachable: 'sev',
};

export default function CustomersPage({
  customers,
  releases,
  platform,
  bucket,
}: {
  /**
   * The shell owns this list, so onboarding a customer has to ask it to read
   * the list again: the new row is the whole point of the drawer, and the page
   * cannot invent one that the hub has not confirmed.
   */
  customers: Resource<CustomerSummaryDto[]> & { reload: () => void };
  releases: Resource<ReleaseDto[]>;
  /** Both come from the URL: a clients-matrix cell is a link into this page. */
  platform: Platform | null;
  bucket: AdoptionBucket | null;
}) {
  const privacy = usePrivacy();
  const [filter, setFilter] = useState<CustomerFilter>(null);
  const [onboarding, setOnboarding] = useState(false);

  const all = useMemo(
    () => (customers.status === 'ready' ? customers.data : []),
    [customers],
  );
  const counts = useMemo(() => customerCounts(all), [all]);
  const perPlatform = useMemo(() => platformCounts(all), [all]);
  const released = useMemo(() => releasedPlatforms(all), [all]);
  const published = useMemo(
    () => (platform === null || releases.status !== 'ready'
      ? []
      : publishedVersions(releases.data, platform)),
    [releases, platform],
  );
  const onPlatform = useMemo(
    () => selectByPlatform(selectCustomers(all, filter), platform),
    [all, filter, platform],
  );
  const perBucket = useMemo(() => bucketCounts(onPlatform, published), [onPlatform, published]);
  const rows = useMemo(
    () => selectByBucket(onPlatform, published, bucket),
    [onPlatform, published, bucket],
  );
  const wired = useMemo(() => planWired(all), [all]);
  const cohort = useCohort(rows, customers.reload);
  const columns = useMemo(
    () => [cohort.column, ...customerColumns(privacy.email, wired)],
    [cohort.column, privacy.email, wired],
  );

  const state: TableState = customers.status === 'loading'
    ? 'loading'
    : customers.status === 'error'
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'ready';

  return (
    <div className="page-wrap">
      <div className="page-head">
        {/* The sentence the page is built around, and the one button that
            adds a row to it. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          {customers.status === 'ready' ? (
            <p className="text-verdict">
              {CUSTOMER_FILTERS.map((id, index) => (
                <span key={id}>
                  {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
                  <button
                    type="button"
                    aria-pressed={filter === id}
                    className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
                    onClick={() => setFilter((current) => (current === id ? null : id))}
                  >
                    <CountText values={[counts[id]]} render={(values) => copy.customerCount[id](values[0])} />
                  </button>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-verdict text-[var(--muted-foreground)]">
              {customers.status === 'loading' ? copy.loading : copy.loadError}
            </p>
          )}
          <div className="ml-auto shrink-0">
            <Action primary onClick={() => setOnboarding(true)}>{copy.onboard}</Action>
          </div>
        </div>

        {/* The fleet page's rule for a column nobody has filled in yet: drop
            it, and say once, quietly, what is missing. */}
        {customers.status === 'ready' && all.length > 0 && !wired ? (
          <p className="text-body text-[var(--muted-foreground)]">{copy.customerPlanNotWired}</p>
        ) : null}

        {/* All five platforms, always. The ones nothing has shipped for say so. */}
        <div className="toolbar-row">
          {PLATFORM_CHIPS.map((id) => {
            const live = released.has(id);
            return (
              <Chip
                key={id}
                muted={!live}
                active={platform === id}
                count={live ? perPlatform[id] : null}
                title={live ? undefined : copy.unreleased}
                onClick={() => setCustomerFilter(platform === id ? null : id, bucket)}
              >
                {live ? copy.platform[id] : `${copy.platform[id]} ${copy.unreleased}`}
              </Chip>
            );
          })}
        </div>

        {/* The version bands only mean something once a platform is chosen:
            "behind one version" of what, otherwise. They arrive already
            pressed when the reader came from a cell of the clients matrix. */}
        {platform === null ? null : (
          <div className="toolbar-row">
            {ADOPTION_BUCKETS.map((id) => (
              <Chip
                key={id}
                active={bucket === id}
                count={perBucket[id]}
                onClick={() => setCustomerFilter(platform, bucket === id ? null : id)}
              >
                {copy.bucket[id]}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {cohort.bar}

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.userId}
        onRowClick={(row) => openCustomer(row.userId)}
        state={state}
        errorMessage={customers.status === 'error' ? customers.message : undefined}
      />

      {cohort.dialog}

      <OnboardDrawer
        open={onboarding}
        onClose={() => setOnboarding(false)}
        onSaved={customers.reload}
      />
    </div>
  );
}
