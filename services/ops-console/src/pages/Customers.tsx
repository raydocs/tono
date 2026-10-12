import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AdoptionBucket,
  CustomerListCounts,
  CustomerSummaryDto,
  FunnelDto,
  Platform,
  ReleaseDto,
  SystemHealthDto,
} from '@contract';
import { ADOPTION_BUCKETS } from '@contract';
import { Action } from '@/components/ops/Action';
import { Chip } from '@/components/ops/Chip';
import { DataGapBanner } from '@/components/ops/DataGapBanner';
import { CountText } from '@/components/ops/CountText';
import { DotJoined } from '@/components/ops/DotJoined';
import { PageNote } from '@/components/ops/PageNote';
import { DataTable, type TableState } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import { followupApi } from '@/lib/api-followups';
import { customerFactsGaps } from '@/lib/customer-facts';
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
  type CustomerFilterId,
} from '@/lib/customers';
import { invitesOf, listRows, selectByStage, stageCounts } from '@/lib/funnel';
import { closeInvite, openCustomer, openInvite, setCustomerFilter } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useIsPhone } from '@/lib/use-phone';
import { publishedVersions } from '@/lib/releases';
import { cn } from '@/lib/utils';
import { oldestFetch, useResource, type Resource } from '@/lib/use-resource';
import '@/styles/customers.css';
import type { Tone } from '@/components/ops/StatusWord';
import { useCohort } from './customer/Cohort';
import { useCustomerView } from './customer/use-customer-view';
import { BatchResults } from './customer/BatchResults';
import { customerColumns, phoneColumns } from './customer/columns';
import { FunnelBar } from './customer/Funnel';
import { InviteDrawer } from './customer/InviteDrawer';
import { ListBand } from './customer/ListBand';
import { ListCharts } from './customer/ListCharts';
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
  listCounts,
  query: initialQuery = null,
}: {
  /**
   * The shell owns this list, so onboarding a customer has to ask it to read
   * the list again: the new row is the whole point of the drawer, and the page
   * cannot invent one that the hub has not confirmed.
   */
  customers: Resource<CustomerSummaryDto[]> & { reload: () => void };
  /** Fleet-wide counts from the list envelope; the page falls back to this view. */
  listCounts?: CustomerListCounts;
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
  query?: string | null;
}) {
  const privacy = usePrivacy();
  const phone = useIsPhone();
  const context = useCustomerView(`${platform ?? ''}/${bucket ?? ''}`, customers.status === 'ready', initialQuery);
  const { filter, stage, sort, query } = context.view;
  const [onboarding, setOnboarding] = useState(false);

  const all = useMemo(
    () => (customers.status === 'ready' ? customers.data : []),
    [customers],
  );
  const counts = useMemo(() => {
    if (!listCounts) return customerCounts(all);
    return {
      all: Object.values(listCounts.byVerdict).reduce((sum, n) => sum + n, 0),
      ok: listCounts.byVerdict.ok,
      unreachable: listCounts.byVerdict.unreachable,
      never_used: listCounts.byVerdict.never_used,
    };
  }, [all, listCounts]);
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
  const perStage = useMemo(
    () => (listCounts ? listCounts.byStage : stageCounts(listRows(all, invites))),
    [all, invites, listCounts],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return selectByStage(table, stage).filter((row) => {
      const person = row.customer ?? row.invite;
      return !needle || [privacy.email(person.email), person.wechatId ?? '', row.customer?.userId ?? '']
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [table, stage, query, privacy]);
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
  /** Of the customers listed, the in-use ones nobody has typed an expiry for. */
  const gaps = useMemo(() => customerFactsGaps(picked), [picked]);
  const columns = useMemo(() => {
    const full = [cohort.column, ...customerColumns(privacy.email, wired, followups, wechat)];
    return withInvites(phone ? phoneColumns(full) : full, privacy.email, wechat);
  }, [cohort.column, privacy.email, wired, followups, wechat, phone]);

  /** One count button per health word; the total comes first. */
  const bits = (counts.all === 0 ? CUSTOMER_FILTERS.slice(0, 1) : CUSTOMER_FILTERS).map((id) => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
      onClick={() => context.change({ filter: filter === id ? null : id, top: 0, left: 0 })}
    >
      <CountText values={[counts[id] ?? 0]} render={(values) => copy.customerCount[id](values[0] ?? 0)} />
    </button>
  ));

  const state: TableState = customers.status === 'loading'
    ? 'loading'
    : customers.status === 'error'
      ? 'error'
      : shown.length === 0
        ? 'empty'
        : 'ready';

  return (
    <div ref={context.container} className="page-wrap customers-page customers-wide">
      {privacy.privacy ? <p className="text-fine" role="status">{copy.privacyCustomerSearchNotice}</p> : null}
      <div className="page-head">
        <section className="customers-hero" aria-label={copy.pages.customers}>
          {/* The sentence the page is built around, and the one button that
              adds a row to it. */}
          <div className="customers-hero-row">
            {customers.status === 'ready' ? (
              <p className="text-verdict">
                <DotJoined parts={phone ? bits.slice(0, 1) : bits} />
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

          {/* On a phone the total is the headline beside the button, and the
              health words are the status line under them. */}
          {phone && customers.status === 'ready' && bits.length > 1 ? (
            <p className="text-body customers-hero-status">
              <DotJoined parts={bits.slice(1)} />
            </p>
          ) : null}

          <PageNote
            className="customers-hero-note"
            fetchedAt={oldestFetch(customers, health)}
            backfill={health.status === 'ready' ? health.data.backfill : null}
          />

          {/* The fleet page's rule for a column nobody has filled in yet: drop
              it, and say once, quietly, what is missing. */}
          {customers.status === 'ready' && all.length > 0 && !wired ? (
            <p className="text-body text-[var(--muted-foreground)]">{copy.customerPlanNotWired}</p>
          ) : null}
        </section>

        {/* All five platforms, always. The ones nothing has shipped for say so.
            The search shares the row and is outside every status branch above,
            so it is there while the list loads and after it fails too. */}
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
          <label className="ops-search ml-auto">
            <Search size={13} aria-hidden />
            <input
              type="search"
              aria-label={copy.traffic.search}
              placeholder={copy.traffic.search}
              value={query}
              onChange={(event) => context.change({ query: event.target.value })}
            />
          </label>
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

      <details className="customers-overview" open={context.view.overview} onToggle={(event) => context.change({ overview: event.currentTarget.open })}>
        <summary className="text-body">{copy.customerOverview}</summary>
        <div className="customers-board">
          <ListBand rows={customers.status === 'ready' ? all : null} />
          <ListCharts
            rows={all}
            state={customers.status === 'ready' ? 'ready' : customers.status}
            asOfSec={customers.status === 'ready' ? customers.fetchedAt : null}
            mask={privacy.email}
            onRetry={customers.reload}
          />
        </div>
      </details>

      {/* Between the filters and the table, because it is the second question
          this page answers and the first one an operator asks in the morning:
          of the people who are paying, who has not started using it. */}
      {customers.status === 'ready' && counts.all > 0 ? (
        <FunnelBar counts={perStage} stage={stage} onPick={(stage) => context.change({ stage, top: 0, left: 0 })} />
      ) : null}

      {customers.status === 'ready' && gaps.noExpiry.length > 0 ? (
        <DataGapBanner
          sentence={copy.customersBoard.expiryGap(gaps.noExpiry.length)}
          action={{
            label: copy.customersBoard.expiryGapAction,
            onClick: () => cohort.pickForExpiry(gaps.noExpiry),
          }}
        />
      ) : null}

      {cohort.bar}
      <BatchResults onChanged={customers.reload} />

      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(row) => row.key}
        /* The address column is the only flexible one: below the fixed
           columns' total it collapses to zero and no scroll can bring it
           back. A local floor keeps identities readable while the container
           keeps the sideways scroll; the phone shows three columns, which fit
           without one. */
        className="customer-list-table min-[641px]:[&>table]:min-w-[1100px]"
        sort={sort}
        onSortChange={(sort) => context.change({ sort })}
        onRowClick={(row) => (row.customer === null
          ? openInvite(row.invite.email)
          : openCustomer(row.customer.userId))}
        state={state}
        /* A stage with nobody on it is an empty customer list, not an empty
           fleet: the table's own default is worded for machines, which on this
           page is an answer to a question nobody asked. */
        emptyMessage={copy.emptyCustomers}
        errorMessage={customers.status === 'error' ? customers.message : undefined}
        onRetry={customers.reload}
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
