import { useMemo, useState } from 'react';
import type {
  AdoptionBucket,
  CustomerSummaryDto,
  FunnelDto,
  FunnelStage,
  Platform,
  ReleaseDto,
  SystemHealthDto,
} from '@contract';
import { ADOPTION_BUCKETS } from '@contract';
import { Action } from '@/components/ops/Action';
import { Chip } from '@/components/ops/Chip';
import { CountText } from '@/components/ops/CountText';
import { PageNote } from '@/components/ops/PageNote';
import { DataTable, type TableState } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import { followupApi } from '@/lib/api-followups';
import {
  bucketCounts,
  CUSTOMER_FILTERS,
  customerCounts,
  newestOpenFollowups,
  planWired,
  PLATFORM_CHIPS,
  platformCounts,
  releasedPlatforms,
  selectByBucket,
  selectByPlatform,
  selectCustomers,
  wechatKnown,
  type CustomerFilter,
  type CustomerFilterId,
} from '@/lib/customers';
import { invitesOf, listRows, selectByStage, stageCounts } from '@/lib/funnel';
import { closeInvite, openCustomer, openInvite, setCustomerFilter } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { publishedVersions } from '@/lib/releases';
import { cn } from '@/lib/utils';
import { newestFetch, useResource, type Resource } from '@/lib/use-resource';
import type { Tone } from '@/components/ops/StatusWord';
import { useCohort } from './customer/Cohort';
import { customerColumns } from './customer/columns';
import { FunnelBar } from './customer/Funnel';
import { InviteDrawer } from './customer/InviteDrawer';
import { withInvites } from './customer/invite-row';
import { OnboardDrawer } from './customer/OnboardDrawer';

/** Only the two health words carry a tone; the total is prose. */
const FRAGMENT_TONE: Record<CustomerFilterId, Tone | 'none'> = {
  all: 'none',
  ok: 'ok',
  unreachable: 'sev',
  // Never a fault's colour: nobody who has not started yet is broken.
  never_used: 'unk',
};

export default function CustomersPage({
  customers,
  funnel,
  releases,
  health,
  platform,
  bucket,
  invite,
}: {
  /**
   * The shell owns this list, so onboarding a customer has to ask it to read
   * the list again: the new row is the whole point of the drawer, and the page
   * cannot invent one that the hub has not confirmed.
   */
  customers: Resource<CustomerSummaryDto[]> & { reload: () => void };
  /**
   * Everyone who has not connected yet. The list is the shell's, like the
   * customers themselves, because the daily page and Command-K read the same
   * one — and it reloads after every write in the invite drawer, since the row
   * that changed is the whole point of having opened it.
   */
  funnel: Resource<FunnelDto> & { reload: () => void };
  health: Resource<SystemHealthDto>;
  releases: Resource<ReleaseDto[]>;
  /** Both come from the URL: a clients-matrix cell is a link into this page. */
  platform: Platform | null;
  bucket: AdoptionBucket | null;
  /** The address whose drawer is open, from the URL: two other pages link here. */
  invite: string | null;
}) {
  const privacy = usePrivacy();
  const [filter, setFilter] = useState<CustomerFilter>(null);
  const [stage, setStage] = useState<FunnelStage | null>(null);
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
  const invites = useMemo(
    () => invitesOf(funnel.status === 'ready' ? funnel.data : null),
    [funnel],
  );
  /**
   * The invites join the table only while nothing is filtering on something
   * they do not have. A health word, a platform and a version band are all
   * measurements of a client, and somebody who never registered has none — so
   * under those filters they are not "no results", they are not applicable.
   */
  const table = useMemo(
    () => listRows(rows, filter === null && platform === null && bucket === null ? invites : []),
    [rows, invites, filter, platform, bucket],
  );
  /** The bar counts the whole fleet, the way the count sentence above it does. */
  const perStage = useMemo(() => stageCounts(listRows(all, invites)), [all, invites]);
  const shown = useMemo(() => selectByStage(table, stage), [table, stage]);
  const picked = useMemo(
    () => shown.map((row) => row.customer).filter((row): row is CustomerSummaryDto => row !== null),
    [shown],
  );
  const wired = useMemo(() => planWired(all), [all]);
  /** The handle column, once anybody on this page has one to put in it. */
  const wechat = useMemo(
    () => (wechatKnown(all) || invites.some((row) => row.wechatId) ? privacy.wechat : null),
    [all, invites, privacy],
  );
  /**
   * Every followup still owed, in one read.
   *
   * The list is the place an operator decides who to open, and "this one is
   * waiting on the customer" is the fact that decides it. The column hides
   * itself while the fleet has none, the way the last three do.
   */
  const owed = useResource('followups', (signal) => followupApi.due('open', signal));
  const followups = useMemo(() => {
    if (owed.status !== 'ready') return null;
    const index = newestOpenFollowups(owed.data.items);
    return index.size === 0 ? null : index;
  }, [owed]);
  const cohort = useCohort(picked, customers.reload);
  const columns = useMemo(
    () => withInvites(
      [cohort.column, ...customerColumns(privacy.email, wired, followups, wechat)],
      privacy.email,
      wechat,
    ),
    [cohort.column, privacy.email, wired, followups, wechat],
  );

  const state: TableState = customers.status === 'loading'
    ? 'loading'
    : customers.status === 'error'
      ? 'error'
      : shown.length === 0
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

        <PageNote
          fetchedAt={newestFetch(customers, health)}
          backfill={health.status === 'ready' ? health.data.backfill : null}
        />

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

      {/* Between the filters and the table, because it is the second question
          this page answers and the first one an operator asks in the morning:
          of the people who are paying, who has not started using it. */}
      {customers.status === 'ready' ? (
        <FunnelBar counts={perStage} stage={stage} onPick={setStage} />
      ) : null}

      {cohort.bar}

      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(row) => row.key}
        onRowClick={(row) => (row.customer === null
          ? openInvite(row.invite.email)
          : openCustomer(row.customer.userId))}
        state={state}
        /* A stage with nobody on it is an empty customer list, not an empty
           fleet: the table's own default is worded for machines, which on this
           page is an answer to a question nobody asked. */
        emptyMessage={copy.emptyCustomers}
        errorMessage={customers.status === 'error' ? customers.message : undefined}
      />

      {cohort.dialog}

      <OnboardDrawer
        open={onboarding}
        onClose={() => setOnboarding(false)}
        onSaved={() => {
          customers.reload();
          funnel.reload();
        }}
      />

      <InviteDrawer
        invite={invites.find((row) => row.email === invite) ?? null}
        onClose={closeInvite}
        onSaved={funnel.reload}
      />
    </div>
  );
}
